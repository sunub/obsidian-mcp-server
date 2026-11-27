import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import {
	AutoTokenizer,
	env,
	type FeatureExtractionPipeline,
	pipeline,
} from "@huggingface/transformers";
import { computeBaselineRrfScores } from "./algorithms/baseline.js";
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

type ModelSpec = {
	id: string;
	modelName: string;
	dtype: "fp32" | "q8";
	cacheDir: string;
	allowRemote: boolean;
	queryPrefix?: string;
	passagePrefix?: string;
};

interface ChunkRow {
	relPath: string;
	text: string;
	content: string;
}

interface ModelEvalMetrics {
	id: string;
	modelName: string;
	dtype: string;
	dim: number;
	chunkCount: number;
	coldLoadMs: number;
	indexSeconds: number;
	embedP50Ms: number;
	embedP95Ms: number;
	rssMb: number;
	vectorMb: number;
	datasets: Record<
		string,
		Record<
			string,
			{
				count: number;
				recall5: number;
				recall10: number;
				mrr10: number;
				hit1: number;
				semanticMrr10: number;
				mrrs: number[];
			}
		>
	>;
}

const MAX_EMBED_TOKENS = 500;
const BATCH_SIZE = 16;
const LIMIT = 10;

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

function topKCosine(
	queryVec: Float32Array,
	matrix: Float32Array,
	chunks: ChunkRow[],
	dim: number,
	k: number,
): DenseCandidate[] {
	const count = chunks.length;
	const scores = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		const offset = i * dim;
		let dot = 0;
		for (let d = 0; d < dim; d++) {
			dot += (queryVec[d] ?? 0) * (matrix[offset + d] ?? 0);
		}
		scores[i] = dot;
	}

	const topIndices: number[] = [];
	for (let i = 0; i < count; i++) {
		const score = scores[i] ?? -1;
		if (topIndices.length < k) {
			topIndices.push(i);
			topIndices.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
		} else if (score > (scores[topIndices[topIndices.length - 1] ?? 0] ?? -1)) {
			topIndices[topIndices.length - 1] = i;
			topIndices.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
		}
	}

	return topIndices.map((idx) => {
		const sim = Math.max(0, Math.min(1, scores[idx] ?? 0));
		const chunk = chunks[idx] as ChunkRow;
		return {
			relPath: chunk.relPath,
			similarity: sim,
			distance: 1 - sim,
			chunkContent: chunk.content,
		};
	});
}

function rankMap(scores: Map<string, number>, limit: number): string[] {
	return [...scores.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([p]) => p);
}

function runVariant(variant: string, ctx: AlgorithmContext): string[] {
	if (variant === "dense_only") {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const hit of ctx.denseHits) {
			if (!seen.has(hit.relPath)) {
				seen.add(hit.relPath);
				out.push(hit.relPath);
				if (out.length >= ctx.limit) break;
			}
		}
		return out;
	}
	if (variant === "baseline_rrf") {
		return rankMap(computeBaselineRrfScores(ctx), ctx.limit);
	}
	if (variant === "cc_a0.5") {
		const denseNorm = normalizeScores(
			extractDenseScores(ctx.denseHits.slice(0, ctx.limit * 3)),
		);
		const bm25Norm = normalizeScores(extractBm25Scores(ctx.keywordHits, 0));
		return rankMap(fuseNormalizedScores(denseNorm, bm25Norm, 0.5), ctx.limit);
	}
	const denseWindow = ctx.denseHits.slice(0, ctx.limit * 3);
	const topBm = ctx.keywordHits[0]?.score ?? 0;
	const floor = denseWindow.length > 0 ? topBm * 0.7 : 0;
	const filtered = ctx.keywordHits.filter((h) => h.score >= floor);
	const denseNorm = normalizeScores(extractDenseScores(denseWindow));
	const bm25Norm = maxNormalizeScores(extractBm25Scores(filtered, 0));
	return rankMap(fuseNormalizedScores(denseNorm, bm25Norm, 0.5), ctx.limit);
}

async function main() {
	const { values } = parseArgs({
		options: {
			vault: { type: "string" },
			models: { type: "string", default: "small-fp32,base-q8,base-fp32" },
			"cache-dir": { type: "string", default: "/tmp/eval-models" },
			out: { type: "string", default: "/tmp/eval-e5-base-results.json" },
		},
	});

	const rawVault = values.vault ?? process.env["VAULT_DIR_PATH"];
	if (!rawVault) {
		console.error(
			"Usage: npx tsx scripts/eval/benchmark-e5-base.ts --vault <path>",
		);
		process.exit(1);
	}

	const vaultPath = resolve(rawVault);
	process.env["VAULT_DIR_PATH"] = vaultPath;
	const evalCacheDir = resolve(values["cache-dir"] as string);
	await mkdir(evalCacheDir, { recursive: true });

	const { MODELS_DIR } = await import("../../build/shared/paths/appData.js");
	const { DirectoryWalker } = await import(
		"../../build/shared/indexing/DirectoryWalker.js"
	);
	const { Indexer } = await import("../../build/shared/indexing/Indexer.js");
	const { Semaphore } = await import("../../build/shared/async/semaphore.js");
	const { createDocumentChunker } = await import(
		"../../build/shared/indexing/worker/chunkDocument.js"
	);

	const toRel = (p: string) => relative(vaultPath, p);
	const walker = new DirectoryWalker([".md", ".mdx"]);
	const sem = new Semaphore(10);
	const filePaths = await walker.walk(vaultPath, sem);
	const indexer = new Indexer();
	await indexer.build(filePaths, sem);

	const fileContents = await Promise.all(
		filePaths.map(async (filePath) => {
			const [content, fileStat] = await Promise.all([
				readFile(filePath, "utf-8"),
				stat(filePath),
			]);
			return {
				filePath,
				relPath: toRel(filePath),
				content,
				birthTime: fileStat.birthtime.toISOString(),
			};
		}),
	);

	const datasets = await loadDatasets();
	const uniqueQueries = [
		...new Set(datasets.flatMap((d) => d.queries.map((q) => q.query))),
	];

	const keywordCache = new Map<string, KeywordCandidate[]>();
	for (const q of uniqueQueries) {
		keywordCache.set(
			q,
			indexer.searchWithChunks(q, 0).map((hit) => ({
				relPath: toRel(hit.document.filePath),
				score: hit.score,
			})),
		);
	}

	const allSpecs: ModelSpec[] = [
		{
			id: "small-fp32",
			modelName: "Xenova/multilingual-e5-small",
			dtype: "fp32",
			cacheDir: MODELS_DIR,
			allowRemote: false,
		},
		{
			id: "base-q8",
			modelName: "Xenova/multilingual-e5-base",
			dtype: "q8",
			cacheDir: evalCacheDir,
			allowRemote: true,
		},
		{
			id: "base-fp32",
			modelName: "Xenova/multilingual-e5-base",
			dtype: "fp32",
			cacheDir: evalCacheDir,
			allowRemote: true,
		},
		{
			id: "base-fp32-prefix",
			modelName: "Xenova/multilingual-e5-base",
			dtype: "fp32",
			cacheDir: evalCacheDir,
			allowRemote: true,
			queryPrefix: "query: ",
			passagePrefix: "passage: ",
		},
	];

	const wanted = new Set((values.models as string).split(","));
	const specs = allSpecs.filter((s) => wanted.has(s.id));
	const results: ModelEvalMetrics[] = [];
	const denseRankingsByModel = new Map<string, Map<string, string[]>>();

	for (const spec of specs) {
		console.error(
			`\n[e5-bench] Loading ${spec.id} (${spec.modelName}, dtype=${spec.dtype})...`,
		);
		env.localModelPath = spec.cacheDir;
		env.cacheDir = spec.cacheDir;
		env.allowRemoteModels = spec.allowRemote;

		const loadStart = performance.now();
		const extractor = (await pipeline("feature-extraction", spec.modelName, {
			dtype: spec.dtype,
		})) as FeatureExtractionPipeline;
		const tokenizer = await AutoTokenizer.from_pretrained(spec.modelName);
		const coldLoadMs = performance.now() - loadStart;

		const chunkDocument = createDocumentChunker(
			(text: string) => tokenizer.encode(text).length,
		);
		const passagePrefix = spec.passagePrefix ?? "";
		const queryPrefix = spec.queryPrefix ?? "";
		const chunks: ChunkRow[] = [];
		for (const file of fileContents) {
			const metaChunks = await chunkDocument({
				filePath: file.filePath,
				fileContent: file.content,
				birthTime: file.birthTime,
			});
			for (const c of metaChunks) {
				const rawCombined = [c.context ? c.context : "", c.content]
					.filter(Boolean)
					.join("\n\n");
				const combined = `${passagePrefix}${rawCombined}`;
				const tokenCount = tokenizer.encode(combined).length;
				const safeText =
					tokenCount > MAX_EMBED_TOKENS
						? combined.slice(
								0,
								Math.floor(combined.length * (MAX_EMBED_TOKENS / tokenCount)),
							)
						: combined;
				chunks.push({
					relPath: file.relPath,
					text: safeText,
					content: c.content,
				});
			}
		}

		const sampleOut = await extractor(`${queryPrefix}warmup`, {
			pooling: "mean",
			normalize: true,
		});
		const dim = sampleOut.data.length;
		const matrix = new Float32Array(chunks.length * dim);

		console.error(
			`[e5-bench] Embedding ${chunks.length} chunks (dim=${dim}, batch=${BATCH_SIZE})...`,
		);
		const idxStart = performance.now();
		for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
			const batch = chunks.slice(i, i + BATCH_SIZE).map((c) => c.text);
			const out = await extractor(batch, { pooling: "mean", normalize: true });
			matrix.set(out.data as Float32Array, i * dim);
		}
		const indexSeconds = (performance.now() - idxStart) / 1000;

		const queryVectors = new Map<string, Float32Array>();
		const embedLatencies: number[] = [];
		for (const [qi, q] of uniqueQueries.entries()) {
			const t0 = performance.now();
			const out = await extractor(`${queryPrefix}${q}`, {
				pooling: "mean",
				normalize: true,
			});
			const elapsed = performance.now() - t0;
			if (qi < 60) embedLatencies.push(elapsed);
			queryVectors.set(q, new Float32Array(out.data as Float32Array));
		}

		const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
		const vectorMb = Number(
			((chunks.length * dim * 4) / (1024 * 1024)).toFixed(1),
		);

		const denseCache = new Map<string, DenseCandidate[]>();
		const denseTopPaths = new Map<string, string[]>();
		for (const q of uniqueQueries) {
			const qv = queryVectors.get(q) as Float32Array;
			const hits = topKCosine(qv, matrix, chunks, dim, 50);
			denseCache.set(q, hits);
			const seen = new Set<string>();
			const top: string[] = [];
			for (const h of hits) {
				if (!seen.has(h.relPath)) {
					seen.add(h.relPath);
					top.push(h.relPath);
					if (top.length >= 10) break;
				}
			}
			denseTopPaths.set(q, top);
		}
		denseRankingsByModel.set(spec.id, denseTopPaths);

		const variants = [
			"dense_only",
			"baseline_rrf",
			"cc_a0.5",
			"cc_a0.5_rel70_max",
		];
		const datasetMetrics: ModelEvalMetrics["datasets"] = {};

		for (const dataset of datasets) {
			datasetMetrics[dataset.name] = {};
			for (const variant of variants) {
				const r5s: number[] = [];
				const r10s: number[] = [];
				const mrrs: number[] = [];
				const hit1s: number[] = [];
				const semMrrs: number[] = [];

				for (const item of dataset.queries) {
					const relevant = resolveRelevant(item, dataset.useLenient);
					if (relevant.length === 0) continue;

					const ctx: AlgorithmContext = {
						query: item.query,
						limit: LIMIT,
						keywordHits: keywordCache.get(item.query) ?? [],
						denseHits: denseCache.get(item.query) ?? [],
						graph: { outLinks: new Map(), inLinks: new Map() },
						documents: [],
						vaultPath,
						embed: async () => [],
						searchVector: async () => [],
						searchKeyword: () => [],
					};

					const ranked = runVariant(variant, ctx);
					const mrr = reciprocalRankAtK(ranked, relevant, 10);
					r5s.push(recallAtK(ranked, relevant, 5));
					r10s.push(recallAtK(ranked, relevant, 10));
					mrrs.push(mrr);
					hit1s.push(hitAtK(ranked, relevant, 1));
					if (item.type === "semantic") semMrrs.push(mrr);
				}

				datasetMetrics[dataset.name][variant] = {
					count: mrrs.length,
					recall5: mean(r5s),
					recall10: mean(r10s),
					mrr10: mean(mrrs),
					hit1: mean(hit1s),
					semanticMrr10: semMrrs.length > 0 ? mean(semMrrs) : Number.NaN,
					mrrs,
				};
			}
		}

		results.push({
			id: spec.id,
			modelName: spec.modelName,
			dtype: spec.dtype,
			dim,
			chunkCount: chunks.length,
			coldLoadMs: Math.round(coldLoadMs),
			indexSeconds: Number(indexSeconds.toFixed(1)),
			embedP50Ms: Number(percentile(embedLatencies, 50).toFixed(1)),
			embedP95Ms: Number(percentile(embedLatencies, 95).toFixed(1)),
			rssMb,
			vectorMb,
			datasets: datasetMetrics,
		});

		await extractor.dispose();
	}

	console.log("\n=== Model Resource & Latency ===");
	console.log(
		[
			"Model".padEnd(14),
			"Dim".padStart(4),
			"Chunks".padStart(6),
			"Cold(ms)".padStart(9),
			"Index(s)".padStart(8),
			"Q-p50ms".padStart(8),
			"Q-p95ms".padStart(8),
			"RSS(MB)".padStart(8),
			"Vec(MB)".padStart(8),
		].join(" | "),
	);
	console.log("-".repeat(92));
	for (const r of results) {
		console.log(
			[
				r.id.padEnd(14),
				String(r.dim).padStart(4),
				String(r.chunkCount).padStart(6),
				String(r.coldLoadMs).padStart(9),
				r.indexSeconds.toFixed(1).padStart(8),
				r.embedP50Ms.toFixed(1).padStart(8),
				r.embedP95Ms.toFixed(1).padStart(8),
				String(r.rssMb).padStart(8),
				r.vectorMb.toFixed(1).padStart(8),
			].join(" | "),
		);
	}

	const baseRef = results.find((r) => r.id === "small-fp32");
	for (const dataset of datasets) {
		console.log(`\n=== ${dataset.name} ===`);
		console.log(
			[
				"Model / Variant".padEnd(32),
				"R@5".padStart(6),
				"R@10".padStart(6),
				"MRR@10".padStart(7),
				"Hit@1".padStart(6),
				"SemMRR".padStart(7),
				"ΔMRR vs small-fp32 [95% CI]",
			].join(" | "),
		);
		console.log("-".repeat(104));
		for (const variant of [
			"dense_only",
			"baseline_rrf",
			"cc_a0.5",
			"cc_a0.5_rel70_max",
		]) {
			const refMrrs = baseRef?.datasets[dataset.name]?.[variant]?.mrrs;
			for (const r of results) {
				const m = r.datasets[dataset.name]?.[variant];
				if (!m) continue;
				let delta = "-";
				if (refMrrs && r.id !== "small-fp32") {
					const d = pairedBootstrap(refMrrs, m.mrrs);
					const sign = d.meanDiff >= 0 ? "+" : "";
					const sig = d.ciLow > 0 || d.ciHigh < 0 ? " *" : "";
					delta = `${sign}${d.meanDiff.toFixed(3)} [${d.ciLow.toFixed(3)}, ${d.ciHigh.toFixed(3)}]${sig}`;
				}
				console.log(
					[
						`${r.id} / ${variant}`.padEnd(32),
						m.recall5.toFixed(3).padStart(6),
						m.recall10.toFixed(3).padStart(6),
						m.mrr10.toFixed(3).padStart(7),
						m.hit1.toFixed(3).padStart(6),
						m.semanticMrr10.toFixed(3).padStart(7),
						delta,
					].join(" | "),
				);
			}
		}
	}

	const blindDataset = datasets.find((d) => d.name === "blind59 (lenient)");
	if (blindDataset) {
		console.log(
			"\n=== blind59 (lenient) Unlabeled Top-3 Rate (Pooling Bias Signal) ===",
		);
		for (const r of results) {
			const rankings = denseRankingsByModel.get(r.id);
			if (!rankings) continue;
			let totalTop1 = 0;
			let unlabeledTop1 = 0;
			let totalTop3 = 0;
			let unlabeledTop3 = 0;
			const top1Misses: Array<{
				id: string;
				type: string;
				query: string;
				top1: string;
				smallTop1: string;
			}> = [];
			const smallRankings = denseRankingsByModel.get("small-fp32");

			for (const item of blindDataset.queries) {
				const lenient = new Set(resolveRelevant(item, true));
				if (lenient.size === 0) continue;
				const top = rankings.get(item.query) ?? [];
				const top1 = top[0];
				if (top1) {
					totalTop1++;
					if (!lenient.has(top1)) {
						unlabeledTop1++;
						const sTop1 = smallRankings?.get(item.query)?.[0] ?? "";
						if (lenient.has(sTop1)) {
							top1Misses.push({
								id: item.id,
								type: item.type,
								query: item.query,
								top1,
								smallTop1: sTop1,
							});
						}
					}
				}
				for (const doc of top.slice(0, 3)) {
					totalTop3++;
					if (!lenient.has(doc)) unlabeledTop3++;
				}
			}
			console.log(
				`${r.id.padEnd(18)} | top1 not-in-lenient: ${unlabeledTop1}/${totalTop1} (${((unlabeledTop1 / Math.max(1, totalTop1)) * 100).toFixed(1)}%) | top3 not-in-lenient: ${unlabeledTop3}/${totalTop3} (${((unlabeledTop3 / Math.max(1, totalTop3)) * 100).toFixed(1)}%) | flipped-from-small: ${top1Misses.length}`,
			);
			if (r.id !== "small-fp32" && top1Misses.length > 0) {
				await writeFile(
					`/tmp/eval-blind-misses-${r.id}.json`,
					JSON.stringify(top1Misses, null, 2),
				);
			}
		}
	}

	const outPath = resolve(values.out as string);
	const slim = results.map(({ datasets: ds, ...rest }) => ({
		...rest,
		datasets: Object.fromEntries(
			Object.entries(ds).map(([dn, vars]) => [
				dn,
				Object.fromEntries(
					Object.entries(vars).map(([vn, { mrrs: _mrrs, ...stats }]) => [
						vn,
						stats,
					]),
				),
			]),
		),
	}));
	if (existsSync(outPath) || outPath.startsWith("/tmp/")) {
		await writeFile(outPath, JSON.stringify(slim, null, 2));
	}
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
