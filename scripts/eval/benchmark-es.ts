import { readFile, stat } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import {
	computeBaselineRrfScores,
	filterByRelativeFloor,
} from "./algorithms/baseline.js";
import {
	extractBm25Scores,
	extractDenseScores,
	fuseNormalizedScores,
	normalizeScores,
} from "./algorithms/convexCombination.js";
import { maxNormalizeScores } from "./algorithms/hybridWinners.js";
import type {
	AlgorithmContext,
	DenseCandidate,
	EvalDataset,
	EvalQuery,
	KeywordCandidate,
} from "./algorithms/types.js";
import { resolveRelevant } from "./compare-algorithms.js";
import {
	hitAtK,
	mean,
	pairedBootstrap,
	percentile,
	recallAtK,
	reciprocalRankAtK,
} from "./lib/metrics.js";

const LIMIT = 10;
const RRF_K = 60;
const CHUNK_INDEX = "obsidian_eval_nori_chunk";
const DOC_INDEX = "obsidian_eval_nori_doc";

async function esRequest<T>(
	esUrl: string,
	path: string,
	options: { method?: string; body?: string; contentType?: string } = {},
): Promise<T> {
	const res = await fetch(`${esUrl}${path}`, {
		method: options.method ?? "GET",
		headers: options.body
			? { "Content-Type": options.contentType ?? "application/json" }
			: undefined,
		body: options.body,
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(
			`ES ${options.method ?? "GET"} ${path} (${res.status}): ${text}`,
		);
	}
	return text ? (JSON.parse(text) as T) : ({} as T);
}

async function readJsonl(filePath: string): Promise<EvalQuery[]> {
	const raw = await readFile(filePath, "utf-8");
	return raw
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as EvalQuery);
}

async function loadDatasets(): Promise<EvalDataset[]> {
	const [core52, holdout15, final100, blind59] = await Promise.all([
		readJsonl("eval/search/queries.jsonl"),
		readJsonl("eval/search/queries-holdout.jsonl"),
		readJsonl("eval/search/queries-final.jsonl"),
		readJsonl("eval/search/queries-blind-labeled.jsonl"),
	]);
	const golden167 = [...core52, ...holdout15, ...final100];
	return [
		{ name: "golden167 (lenient)", queries: golden167, useLenient: true },
		{ name: "blind59 (strict)", queries: blind59, useLenient: false },
		{ name: "blind59 (lenient)", queries: blind59, useLenient: true },
	];
}

function buildNoriSettings() {
	return {
		number_of_shards: 1,
		number_of_replicas: 0,
		analysis: {
			tokenizer: {
				korean_nori_tokenizer: {
					type: "nori_tokenizer",
					decompound_mode: "mixed",
				},
			},
			analyzer: {
				korean_nori: {
					type: "custom",
					tokenizer: "korean_nori_tokenizer",
					filter: ["nori_part_of_speech", "nori_readingform", "lowercase"],
				},
			},
		},
	};
}

interface EsHit {
	_score: number;
	_source: {
		relPath: string;
		content?: string;
	};
}

interface EsSearchResponse {
	hits: {
		hits: EsHit[];
	};
}

function dedupeHitsToKeywords(hits: EsHit[]): KeywordCandidate[] {
	const best = new Map<string, number>();
	for (const hit of hits) {
		const p = hit._source.relPath;
		const prev = best.get(p);
		if (prev === undefined || hit._score > prev) {
			best.set(p, hit._score);
		}
	}
	return [...best.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([relPath, score]) => ({ relPath, score }));
}

function fuseRrf(
	keywordHits: KeywordCandidate[],
	denseHits: DenseCandidate[],
	limit: number,
	minRelativeScore: number,
): string[] {
	const semanticWindow = denseHits.slice(0, limit * 3);
	const filtered = filterByRelativeFloor(
		keywordHits,
		semanticWindow.length > 0 ? minRelativeScore : 0,
	);
	const scores = new Map<string, number>();
	filtered.forEach((hit, rank) => {
		scores.set(hit.relPath, 1 / (RRF_K + rank + 1));
	});
	const seen = new Set<string>();
	let vRank = 0;
	for (const hit of semanticWindow) {
		if (!seen.has(hit.relPath)) {
			seen.add(hit.relPath);
			scores.set(
				hit.relPath,
				(scores.get(hit.relPath) ?? 0) + 1 / (RRF_K + vRank + 1),
			);
			vRank++;
		}
	}
	return [...scores.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([p]) => p);
}

function fuseCc(
	keywordHits: KeywordCandidate[],
	denseHits: DenseCandidate[],
	limit: number,
	minRelativeScore: number,
	useMaxNorm: boolean,
): string[] {
	const denseWindow = denseHits.slice(0, limit * 3);
	const filtered = filterByRelativeFloor(
		keywordHits,
		denseWindow.length > 0 ? minRelativeScore : 0,
	);
	const denseNorm = normalizeScores(extractDenseScores(denseWindow));
	const bm25Raw = extractBm25Scores(filtered, 0);
	const bm25Norm = useMaxNorm
		? maxNormalizeScores(bm25Raw)
		: normalizeScores(bm25Raw);
	const fused = fuseNormalizedScores(denseNorm, bm25Norm, 0.5);
	return [...fused.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([p]) => p);
}

async function main() {
	const { values } = parseArgs({
		options: {
			vault: { type: "string" },
			"es-url": { type: "string", default: "http://127.0.0.1:9200" },
		},
	});

	const rawVault = values.vault ?? process.env["VAULT_DIR_PATH"];
	if (!rawVault) {
		console.error(
			"Usage: npx tsx scripts/eval/benchmark-es.ts --vault <path> [--es-url http://127.0.0.1:9200]",
		);
		process.exit(1);
	}

	const esUrl = (values["es-url"] as string).replace(/\/$/, "");
	const vaultPath = resolve(rawVault);
	process.env["VAULT_DIR_PATH"] = vaultPath;

	const pluginsText = await fetch(`${esUrl}/_cat/plugins?format=json`).then(
		(r) => r.json() as Promise<Array<{ component: string }>>,
	);
	const hasNori = pluginsText.some((p) => p.component === "analysis-nori");
	if (!hasNori) {
		throw new Error("analysis-nori plugin is not installed in Elasticsearch");
	}
	console.error(`[es-bench] Connected to ${esUrl} (analysis-nori verified)`);

	const { DirectoryWalker } = await import(
		"../../build/shared/indexing/DirectoryWalker.js"
	);
	const { Indexer } = await import("../../build/shared/indexing/Indexer.js");
	const { Semaphore } = await import("../../build/shared/async/semaphore.js");
	const { localEmbedder } = await import(
		"../../build/shared/local-ai/Embedder.js"
	);
	const { vectorDB } = await import("../../build/shared/indexing/VectorDB.js");
	const { localModelManager } = await import(
		"../../build/shared/local-ai/LocalModelManager.js"
	);
	const MatterParser = await import(
		"../../build/shared/markdown/MatterParser.js"
	);
	const { stripEmbeddedData } = await import(
		"../../build/shared/markdown/stripEmbeddedData.js"
	);

	const toRel = (p: string) => relative(vaultPath, p);
	const walker = new DirectoryWalker([".md", ".mdx"]);
	const sem = new Semaphore(10);
	const filePaths = await walker.walk(vaultPath, sem);
	const indexer = new Indexer();
	await indexer.build(filePaths, sem);
	await localEmbedder.init();

	const table = await vectorDB.getTable();
	if (!table) {
		throw new Error(
			"LanceDB table missing; run indexing-benchmark --rag first",
		);
	}
	const storedChunks = (await table.query().toArray()) as Array<{
		id: string;
		filePath: string;
		fileName: string;
		content: string;
		context?: string;
		vector: Iterable<number>;
		metadata: { title: string; tags: string };
	}>;

	for (const idx of [CHUNK_INDEX, DOC_INDEX]) {
		await fetch(`${esUrl}/${idx}`, { method: "DELETE" });
	}

	await esRequest(esUrl, `/${CHUNK_INDEX}`, {
		method: "PUT",
		body: JSON.stringify({
			settings: buildNoriSettings(),
			mappings: {
				properties: {
					relPath: { type: "keyword" },
					title: { type: "text", analyzer: "korean_nori" },
					fileName: { type: "text", analyzer: "korean_nori" },
					tags: { type: "text", analyzer: "korean_nori" },
					content: { type: "text", analyzer: "korean_nori" },
					vector: {
						type: "dense_vector",
						dims: 384,
						index: true,
						similarity: "cosine",
					},
				},
			},
		}),
	});

	await esRequest(esUrl, `/${DOC_INDEX}`, {
		method: "PUT",
		body: JSON.stringify({
			settings: buildNoriSettings(),
			mappings: {
				properties: {
					relPath: { type: "keyword" },
					title: { type: "text", analyzer: "korean_nori" },
					fileName: { type: "text", analyzer: "korean_nori" },
					tags: { type: "text", analyzer: "korean_nori" },
					content: { type: "text", analyzer: "korean_nori" },
				},
			},
		}),
	});

	const chunkIndexStart = performance.now();
	const BULK_BATCH = 500;
	for (let i = 0; i < storedChunks.length; i += BULK_BATCH) {
		const slice = storedChunks.slice(i, i + BULK_BATCH);
		const lines: string[] = [];
		for (const c of slice) {
			const relPath = toRel(c.filePath);
			const fileStem = basename(relPath, extname(relPath)).normalize("NFC");
			lines.push(JSON.stringify({ index: { _index: CHUNK_INDEX } }));
			lines.push(
				JSON.stringify({
					relPath,
					title: (c.metadata?.title ?? "").normalize("NFC"),
					fileName: fileStem,
					tags: (c.metadata?.tags ?? "").normalize("NFC"),
					content: c.content.normalize("NFC"),
					vector: Array.from(c.vector),
				}),
			);
		}
		await esRequest(esUrl, "/_bulk", {
			method: "POST",
			contentType: "application/x-ndjson",
			body: `${lines.join("\n")}\n`,
		});
	}
	await esRequest(esUrl, `/${CHUNK_INDEX}/_refresh`, { method: "POST" });
	const chunkIndexMs = performance.now() - chunkIndexStart;

	const docLines: string[] = [];
	for (const filePath of filePaths) {
		const [raw, fileStat] = await Promise.all([
			readFile(filePath, "utf-8"),
			stat(filePath),
		]);
		const { frontmatter, content } = MatterParser.parse(
			filePath,
			fileStat.birthtime.toISOString(),
			raw,
		);
		const relPath = toRel(filePath);
		const fileStem = basename(relPath, extname(relPath)).normalize("NFC");
		docLines.push(JSON.stringify({ index: { _index: DOC_INDEX } }));
		docLines.push(
			JSON.stringify({
				relPath,
				title: (frontmatter.title ?? "").normalize("NFC"),
				fileName: fileStem,
				tags: (frontmatter.tags ?? []).join(" ").normalize("NFC"),
				content: stripEmbeddedData(content).normalize("NFC"),
			}),
		);
	}
	await esRequest(esUrl, "/_bulk", {
		method: "POST",
		contentType: "application/x-ndjson",
		body: `${docLines.join("\n")}\n`,
	});
	await esRequest(esUrl, `/${DOC_INDEX}/_refresh`, { method: "POST" });

	console.error(
		`[es-bench] Indexed ${storedChunks.length} chunks (${chunkIndexMs.toFixed(0)}ms) + ${filePaths.length} full docs`,
	);

	const datasets = await loadDatasets();
	const uniqueQueries = [
		...new Set(datasets.flatMap((d) => d.queries.map((q) => q.query))),
	];

	const caches = {
		embKeyword: new Map<string, KeywordCandidate[]>(),
		embDense: new Map<string, DenseCandidate[]>(),
		esNoriChunk: new Map<string, KeywordCandidate[]>(),
		esNoriChunkFuzzy: new Map<string, KeywordCandidate[]>(),
		esNoriDoc: new Map<string, KeywordCandidate[]>(),
		esDenseHnsw: new Map<string, DenseCandidate[]>(),
	};
	const latencies = {
		embHybrid: [] as number[],
		esNoriChunk: [] as number[],
		esDenseHnsw: [] as number[],
		esHybrid: [] as number[],
	};

	for (const query of uniqueQueries) {
		const tEmb0 = performance.now();
		const qVec = await localEmbedder.embed(query);
		const lanceRaw = await vectorDB.search(qVec, 30);
		const embKw = indexer.searchWithChunks(query, 0).map((h) => ({
			relPath: toRel(h.document.filePath),
			score: h.score,
		}));
		const embDense: DenseCandidate[] = lanceRaw
			.filter((c) => indexer.getDocument(c.filePath) !== null)
			.map((c) => ({
				relPath: toRel(c.filePath),
				distance: c._distance,
				similarity: Math.max(0, 1 - c._distance),
				chunkContent: c.content,
			}));
		latencies.embHybrid.push(performance.now() - tEmb0);
		caches.embKeyword.set(query, embKw);
		caches.embDense.set(query, embDense);

		const tEsKw0 = performance.now();
		const chunkRes = await esRequest<EsSearchResponse>(
			esUrl,
			`/${CHUNK_INDEX}/_search`,
			{
				method: "POST",
				body: JSON.stringify({
					size: 100,
					_source: ["relPath"],
					query: {
						multi_match: {
							query: query.normalize("NFC"),
							fields: ["title^3", "fileName^2", "tags^2", "content"],
						},
					},
				}),
			},
		);
		const esKwMs = performance.now() - tEsKw0;
		latencies.esNoriChunk.push(esKwMs);
		caches.esNoriChunk.set(query, dedupeHitsToKeywords(chunkRes.hits.hits));

		const fuzzyRes = await esRequest<EsSearchResponse>(
			esUrl,
			`/${CHUNK_INDEX}/_search`,
			{
				method: "POST",
				body: JSON.stringify({
					size: 100,
					_source: ["relPath"],
					query: {
						multi_match: {
							query: query.normalize("NFC"),
							fields: ["title^3", "fileName^2", "tags^2", "content"],
							fuzziness: "AUTO",
						},
					},
				}),
			},
		);
		caches.esNoriChunkFuzzy.set(
			query,
			dedupeHitsToKeywords(fuzzyRes.hits.hits),
		);

		const docRes = await esRequest<EsSearchResponse>(
			esUrl,
			`/${DOC_INDEX}/_search`,
			{
				method: "POST",
				body: JSON.stringify({
					size: 50,
					_source: ["relPath"],
					query: {
						multi_match: {
							query: query.normalize("NFC"),
							fields: ["title^3", "fileName^2", "tags^2", "content"],
						},
					},
				}),
			},
		);
		caches.esNoriDoc.set(query, dedupeHitsToKeywords(docRes.hits.hits));

		const tEsKnn0 = performance.now();
		const knnRes = await esRequest<EsSearchResponse>(
			esUrl,
			`/${CHUNK_INDEX}/_search`,
			{
				method: "POST",
				body: JSON.stringify({
					size: 30,
					_source: ["relPath", "content"],
					knn: {
						field: "vector",
						query_vector: qVec,
						k: 30,
						num_candidates: 200,
					},
				}),
			},
		);
		const esKnnMs = performance.now() - tEsKnn0;
		latencies.esDenseHnsw.push(esKnnMs);
		latencies.esHybrid.push(esKwMs + esKnnMs);
		caches.esDenseHnsw.set(
			query,
			knnRes.hits.hits.map((h) => {
				const sim = Math.max(0, Math.min(1, 2 * h._score - 1));
				return {
					relPath: h._source.relPath,
					similarity: sim,
					distance: 1 - sim,
					chunkContent: h._source.content ?? "",
				};
			}),
		);
	}

	const systems: Array<{ name: string; run: (q: string) => string[] }> = [
		{
			name: "embedded_baseline_rrf",
			run: (q) => {
				const ctx: AlgorithmContext = {
					query: q,
					limit: LIMIT,
					keywordHits: caches.embKeyword.get(q) ?? [],
					denseHits: caches.embDense.get(q) ?? [],
					graph: { outLinks: new Map(), inLinks: new Map() },
					documents: [],
					vaultPath,
					embed: async () => [],
					searchVector: async () => [],
					searchKeyword: () => [],
				};
				return [...computeBaselineRrfScores(ctx).entries()]
					.sort((a, b) => b[1] - a[1])
					.slice(0, LIMIT)
					.map(([p]) => p);
			},
		},
		{
			name: "embedded_keyword_only",
			run: (q) =>
				(caches.embKeyword.get(q) ?? []).slice(0, LIMIT).map((h) => h.relPath),
		},
		{
			name: "es_nori_chunk_only",
			run: (q) =>
				(caches.esNoriChunk.get(q) ?? []).slice(0, LIMIT).map((h) => h.relPath),
		},
		{
			name: "es_nori_doc_only",
			run: (q) =>
				(caches.esNoriDoc.get(q) ?? []).slice(0, LIMIT).map((h) => h.relPath),
		},
		{
			name: "es_nori_fuzzy_only",
			run: (q) =>
				(caches.esNoriChunkFuzzy.get(q) ?? [])
					.slice(0, LIMIT)
					.map((h) => h.relPath),
		},
		{
			name: "es_dense_hnsw_only",
			run: (q) => {
				const seen = new Set<string>();
				const out: string[] = [];
				for (const h of caches.esDenseHnsw.get(q) ?? []) {
					if (!seen.has(h.relPath)) {
						seen.add(h.relPath);
						out.push(h.relPath);
						if (out.length >= LIMIT) break;
					}
				}
				return out;
			},
		},
		{
			name: "es_hybrid_rrf_nofloor",
			run: (q) =>
				fuseRrf(
					caches.esNoriChunk.get(q) ?? [],
					caches.esDenseHnsw.get(q) ?? [],
					LIMIT,
					0,
				),
		},
		{
			name: "es_hybrid_rrf_rel70",
			run: (q) =>
				fuseRrf(
					caches.esNoriChunk.get(q) ?? [],
					caches.esDenseHnsw.get(q) ?? [],
					LIMIT,
					0.7,
				),
		},
		{
			name: "es_hybrid_cc_a0.5",
			run: (q) =>
				fuseCc(
					caches.esNoriChunk.get(q) ?? [],
					caches.esDenseHnsw.get(q) ?? [],
					LIMIT,
					0,
					false,
				),
		},
		{
			name: "es_hybrid_cc_rel70_max",
			run: (q) =>
				fuseCc(
					caches.esNoriChunk.get(q) ?? [],
					caches.esDenseHnsw.get(q) ?? [],
					LIMIT,
					0.7,
					true,
				),
		},
	];

	console.log(
		"\n=== ES vs Embedded Latency (ms, excluding query embed for ES-only ops) ===",
	);
	console.log(
		`embedded_hybrid (embed+LanceDB+BM25): p50=${percentile(latencies.embHybrid, 50).toFixed(1)}ms, p95=${percentile(latencies.embHybrid, 95).toFixed(1)}ms`,
	);
	console.log(
		`es_nori_chunk HTTP: p50=${percentile(latencies.esNoriChunk, 50).toFixed(1)}ms, p95=${percentile(latencies.esNoriChunk, 95).toFixed(1)}ms`,
	);
	console.log(
		`es_dense_hnsw HTTP: p50=${percentile(latencies.esDenseHnsw, 50).toFixed(1)}ms, p95=${percentile(latencies.esDenseHnsw, 95).toFixed(1)}ms`,
	);
	console.log(
		`es_hybrid HTTP (kw+knn, excl. embed): p50=${percentile(latencies.esHybrid, 50).toFixed(1)}ms, p95=${percentile(latencies.esHybrid, 95).toFixed(1)}ms`,
	);

	for (const dataset of datasets) {
		console.log(`\n=== ${dataset.name} ===`);
		console.log(
			[
				"System".padEnd(26),
				"R@5".padStart(6),
				"R@10".padStart(6),
				"MRR@10".padStart(7),
				"Hit@1".padStart(6),
				"SemMRR".padStart(7),
				"ΔMRR vs embedded_rrf [95% CI]",
			].join(" | "),
		);
		console.log("-".repeat(102));

		let baselineMrrs: number[] | null = null;
		for (const sys of systems) {
			const r5s: number[] = [];
			const r10s: number[] = [];
			const mrrs: number[] = [];
			const hit1s: number[] = [];
			const semMrrs: number[] = [];

			for (const item of dataset.queries) {
				const relevant = resolveRelevant(item, dataset.useLenient);
				if (relevant.length === 0) continue;
				const ranked = sys.run(item.query);
				const mrr = reciprocalRankAtK(ranked, relevant, 10);
				r5s.push(recallAtK(ranked, relevant, 5));
				r10s.push(recallAtK(ranked, relevant, 10));
				mrrs.push(mrr);
				hit1s.push(hitAtK(ranked, relevant, 1));
				if (item.type === "semantic") semMrrs.push(mrr);
			}

			if (sys.name === "embedded_baseline_rrf") {
				baselineMrrs = mrrs;
			}

			let delta = "-";
			if (baselineMrrs && sys.name !== "embedded_baseline_rrf") {
				const d = pairedBootstrap(baselineMrrs, mrrs);
				const sign = d.meanDiff >= 0 ? "+" : "";
				const sig = d.ciLow > 0 || d.ciHigh < 0 ? " *" : "";
				delta = `${sign}${d.meanDiff.toFixed(3)} [${d.ciLow.toFixed(3)}, ${d.ciHigh.toFixed(3)}]${sig}`;
			}

			console.log(
				[
					sys.name.padEnd(26),
					mean(r5s).toFixed(3).padStart(6),
					mean(r10s).toFixed(3).padStart(6),
					mean(mrrs).toFixed(3).padStart(7),
					mean(hit1s).toFixed(3).padStart(6),
					(semMrrs.length > 0 ? mean(semMrrs).toFixed(3) : "  -  ").padStart(7),
					delta,
				].join(" | "),
			);
		}
	}

	await localModelManager.shutdown();
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
