import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { algorithms } from "./algorithms/index.js";
import type {
	AlgorithmContext,
	DenseCandidate,
	EvalDataset,
	EvalDocument,
	EvalQuery,
	KeywordCandidate,
	LinkGraph,
	SearchAlgorithm,
} from "./algorithms/types.js";
import { normalizeGoldenQuery } from "./lib/goldenSet.js";
import {
	auroc,
	bpref,
	hitAtK,
	judgedAtK,
	mean,
	ndcgAtK,
	pairedBootstrap,
	percentile,
	recallAtK,
	reciprocalRankAtK,
} from "./lib/metrics.js";

export interface QueryScore {
	id: string;
	type: string;
	recall5: number;
	recall10: number;
	mrr10: number;
	ndcg10: number;
	bpref: number;
	judged5: number;
	hit1: number;
	latencyMs: number;
}

export interface AlgorithmSummary {
	name: string;
	count: number;
	recall5: number;
	recall10: number;
	mrr10: number;
	ndcg10: number;
	bpref: number;
	judged5: number;
	hit1: number;
	semanticMrr10: number;
	p50Ms: number;
	scores: QueryScore[];
}

const LIMIT = 10;
const DENSE_CANDIDATE_POOL = 50;
const MARKDOWN_EXT = /\.mdx?$/i;

function normalizeLinkKey(value: string): string {
	return value.normalize("NFC").toLowerCase().replace(MARKDOWN_EXT, "");
}

export function buildLinkGraph(
	docs: Array<{ relPath: string; documentLinks: string[] }>,
): LinkGraph {
	const byRelKey = new Map<string, string>();
	const byBaseKey = new Map<string, string>();

	for (const doc of docs) {
		byRelKey.set(normalizeLinkKey(doc.relPath), doc.relPath);
		const base = normalizeLinkKey(basename(doc.relPath, extname(doc.relPath)));
		if (!byBaseKey.has(base)) {
			byBaseKey.set(base, doc.relPath);
		}
	}

	const outLinks = new Map<string, string[]>();
	const inLinkSets = new Map<string, Set<string>>();

	for (const doc of docs) {
		const targets = new Set<string>();
		for (const rawLink of doc.documentLinks) {
			const key = normalizeLinkKey(rawLink.trim());
			const target = byRelKey.get(key) ?? byBaseKey.get(key);
			if (target && target !== doc.relPath) {
				targets.add(target);
			}
		}
		outLinks.set(doc.relPath, [...targets]);
		for (const target of targets) {
			const sources = inLinkSets.get(target) ?? new Set<string>();
			sources.add(doc.relPath);
			inLinkSets.set(target, sources);
		}
	}

	const inLinks = new Map<string, string[]>();
	for (const [target, sources] of inLinkSets) {
		inLinks.set(target, [...sources]);
	}

	return { outLinks, inLinks };
}

export function resolveRelevant(
	query: EvalQuery,
	useLenient: boolean,
): string[] {
	if (useLenient && query.relevant_lenient) {
		return query.relevant_lenient;
	}
	return query.relevant;
}

export async function scoreAlgorithm(
	algorithm: SearchAlgorithm,
	dataset: EvalDataset,
	buildContext: (query: EvalQuery) => Promise<AlgorithmContext>,
): Promise<AlgorithmSummary> {
	const scores: QueryScore[] = [];
	const minRelevantGrade = dataset.useLenient ? 1 : 2;

	for (const rawItem of dataset.queries) {
		const item = normalizeGoldenQuery(rawItem);
		const relevant = resolveRelevant(item, dataset.useLenient);
		if (relevant.length === 0) continue;

		const ctx = await buildContext(item);
		const start = performance.now();
		const ranked = await algorithm.run(ctx);
		const latencyMs = performance.now() - start;

		scores.push({
			id: item.id,
			type: item.type,
			recall5: recallAtK(ranked, relevant, 5),
			recall10: recallAtK(ranked, relevant, 10),
			mrr10: reciprocalRankAtK(ranked, relevant, 10),
			ndcg10: ndcgAtK(ranked, item.grades, 10),
			bpref: bpref(ranked, item.grades, minRelevantGrade),
			judged5: judgedAtK(ranked, item.grades, 5),
			hit1: hitAtK(ranked, relevant, 1),
			latencyMs,
		});
	}

	const semanticScores = scores.filter((s) => s.type === "semantic");
	return {
		name: algorithm.name,
		count: scores.length,
		recall5: mean(scores.map((s) => s.recall5)),
		recall10: mean(scores.map((s) => s.recall10)),
		mrr10: mean(scores.map((s) => s.mrr10)),
		ndcg10: mean(scores.map((s) => s.ndcg10)),
		bpref: mean(scores.map((s) => s.bpref)),
		judged5: mean(scores.map((s) => s.judged5)),
		hit1: mean(scores.map((s) => s.hit1)),
		semanticMrr10:
			semanticScores.length > 0
				? mean(semanticScores.map((s) => s.mrr10))
				: Number.NaN,
		p50Ms: percentile(
			scores.map((s) => s.latencyMs),
			50,
		),
		scores,
	};
}

function formatNum(value: number, digits = 3): string {
	return Number.isNaN(value) ? "  -  " : value.toFixed(digits);
}

function formatDelta(
	baseline: AlgorithmSummary | undefined,
	current: AlgorithmSummary,
): string {
	if (!baseline || baseline.name === current.name) return "-";
	const diff = pairedBootstrap(
		baseline.scores.map((s) => s.mrr10),
		current.scores.map((s) => s.mrr10),
	);
	const sign = diff.meanDiff >= 0 ? "+" : "";
	const sig = diff.ciLow > 0 || diff.ciHigh < 0 ? " *" : "";
	return `${sign}${diff.meanDiff.toFixed(3)} [${diff.ciLow.toFixed(3)}, ${diff.ciHigh.toFixed(3)}]${sig}`;
}

function printDatasetReport(
	datasetName: string,
	summaries: AlgorithmSummary[],
): void {
	const baseline = summaries.find((s) => s.name === "baseline_rrf");
	const count = summaries[0]?.count ?? 0;

	console.log(`\n=== ${datasetName} (n=${count}) ===`);
	console.log(
		[
			"Algorithm".padEnd(20),
			"R@5".padStart(5),
			"MRR@10".padStart(6),
			"nDCG10".padStart(6),
			"bpref".padStart(5),
			"J@5".padStart(5),
			"Hit@1".padStart(5),
			"SemMRR".padStart(6),
			"ΔMRR vs baseline [95% CI]",
		].join(" | "),
	);
	console.log("-".repeat(110));

	for (const summary of summaries) {
		console.log(
			[
				summary.name.padEnd(20),
				formatNum(summary.recall5).padStart(5),
				formatNum(summary.mrr10).padStart(6),
				formatNum(summary.ndcg10).padStart(6),
				formatNum(summary.bpref).padStart(5),
				formatNum(summary.judged5).padStart(5),
				formatNum(summary.hit1).padStart(5),
				formatNum(summary.semanticMrr10).padStart(6),
				formatDelta(baseline, summary),
			].join(" | "),
		);
	}
}

async function readJsonl(filePath: string): Promise<EvalQuery[]> {
	const raw = await readFile(filePath, "utf-8");
	return raw
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as EvalQuery);
}

async function loadDatasets(setName: string): Promise<EvalDataset[]> {
	const files = {
		core52: "eval/search/queries.jsonl",
		holdout15: "eval/search/queries-holdout.jsonl",
		final100: "eval/search/queries-final.jsonl",
		blind59: "eval/search/queries-blind-labeled.jsonl",
	};

	const loadIfExists = async (path: string) =>
		existsSync(path) ? readJsonl(path) : [];

	if (setName === "core52") {
		return [
			{
				name: "core52",
				queries: await loadIfExists(files.core52),
				useLenient: false,
			},
		];
	}
	if (setName === "holdout15") {
		return [
			{
				name: "holdout15",
				queries: await loadIfExists(files.holdout15),
				useLenient: false,
			},
		];
	}
	if (setName === "final100") {
		const queries = await loadIfExists(files.final100);
		return [
			{ name: "final100 (lenient)", queries, useLenient: true },
			{ name: "final100 (strict)", queries, useLenient: false },
		];
	}
	if (setName === "blind59") {
		const queries = await loadIfExists(files.blind59);
		return [
			{ name: "blind59 (strict)", queries, useLenient: false },
			{ name: "blind59 (lenient)", queries, useLenient: true },
		];
	}

	const [core52, holdout15, final100, blind59] = await Promise.all([
		loadIfExists(files.core52),
		loadIfExists(files.holdout15),
		loadIfExists(files.final100),
		loadIfExists(files.blind59),
	]);
	const golden167 = [...core52, ...holdout15, ...final100];

	if (setName === "golden167") {
		return [
			{ name: "golden167 (lenient)", queries: golden167, useLenient: true },
		];
	}

	return [
		{ name: "golden167 (lenient)", queries: golden167, useLenient: true },
		{ name: "blind59 (strict)", queries: blind59, useLenient: false },
		{ name: "blind59 (lenient)", queries: blind59, useLenient: true },
	];
}

async function main() {
	const { values } = parseArgs({
		options: {
			vault: { type: "string" },
			set: { type: "string", default: "all" },
			only: { type: "string" },
		},
	});

	const rawVault = values.vault ?? process.env["VAULT_DIR_PATH"];
	if (!rawVault) {
		console.error(
			"Usage: npx tsx scripts/eval/compare-algorithms.ts --vault <vault-copy-path> [--set all|golden167|blind59|final100|core52|holdout15] [--only a,b]",
		);
		process.exit(1);
	}

	const vaultPath = resolve(rawVault);
	process.env["VAULT_DIR_PATH"] = vaultPath;

	const { Indexer } = await import("../../build/shared/indexing/Indexer.js");
	const { DirectoryWalker } = await import(
		"../../build/shared/indexing/DirectoryWalker.js"
	);
	const { Semaphore } = await import("../../build/shared/async/semaphore.js");
	const { localEmbedder } = await import(
		"../../build/shared/local-ai/Embedder.js"
	);
	const { INDEX_VERSION, vectorDB } = await import(
		"../../build/shared/indexing/VectorDB.js"
	);
	const { localModelManager } = await import(
		"../../build/shared/local-ai/LocalModelManager.js"
	);
	const MatterParser = await import(
		"../../build/shared/markdown/MatterParser.js"
	);

	const db = await vectorDB.connect();
	const tables = await db.tableNames();
	if (
		!tables.includes("obsidian_meta") ||
		!tables.includes("obsidian_chunks")
	) {
		console.error(
			`[error] Vector cache missing in ${vaultPath}/.obsidian/vector_cache. Run indexing-benchmark.ts --rag first.`,
		);
		process.exit(1);
	}
	const metaTable = await db.openTable("obsidian_meta");
	const metaRows = (await metaTable.query().toArray()) as Array<{
		key: string;
		value: string;
	}>;
	const storedVersion = Number.parseInt(
		metaRows.find((r) => r.key === "index_version")?.value ?? "0",
		10,
	);
	if (storedVersion !== INDEX_VERSION) {
		console.error(
			`[error] Vector cache version mismatch (stored: v${storedVersion}, expected: v${INDEX_VERSION} for ${localEmbedder.modelName}). Re-index the vault copy before comparing algorithms.`,
		);
		process.exit(1);
	}

	const toRel = (filePath: string) => relative(vaultPath, filePath);

	const walker = new DirectoryWalker([".md", ".mdx"]);
	const semaphore = new Semaphore(10);
	const filePaths = await walker.walk(vaultPath, semaphore);
	const indexer = new Indexer();
	await indexer.build(filePaths, semaphore);

	const documents: EvalDocument[] = await Promise.all(
		filePaths.map(async (filePath) => {
			const [raw, fileStat] = await Promise.all([
				readFile(filePath, "utf-8"),
				stat(filePath),
			]);
			const { frontmatter, content } = MatterParser.parse(
				filePath,
				fileStat.birthtime.toISOString(),
				raw,
			);
			return {
				relPath: toRel(filePath),
				title: frontmatter.title ?? "",
				tags: frontmatter.tags ?? [],
				body: content,
			};
		}),
	);

	const graph = buildLinkGraph(
		indexer.getAllDocuments().map((doc) => ({
			relPath: toRel(doc.filePath),
			documentLinks: doc.documentLinks,
		})),
	);

	await localEmbedder.init();

	const selectedAlgorithms = values.only
		? algorithms.filter((alg) =>
				new Set((values.only as string).split(",")).has(alg.name),
			)
		: algorithms;

	const datasets = await loadDatasets(values.set as string);
	const searchVector = async (
		vector: number[],
		limit: number,
	): Promise<DenseCandidate[]> => {
		const raw = await vectorDB.search(vector, limit);
		return raw
			.filter((chunk) => indexer.getDocument(chunk.filePath) !== null)
			.map((chunk) => ({
				relPath: toRel(chunk.filePath),
				distance: chunk._distance,
				similarity: Math.max(0, 1 - chunk._distance),
				chunkContent: chunk.content,
			}));
	};

	const searchKeyword = (
		query: string,
		minRelativeScore = 0,
	): KeywordCandidate[] =>
		indexer.searchWithChunks(query, minRelativeScore).map((hit) => ({
			relPath: toRel(hit.document.filePath),
			score: hit.score,
		}));

	const cachedContexts = new Map<string, AlgorithmContext>();
	const getContext = async (item: EvalQuery): Promise<AlgorithmContext> => {
		const cached = cachedContexts.get(item.query);
		if (cached) return cached;

		const queryVector = await localEmbedder.embed(item.query);
		const denseHits = await searchVector(queryVector, DENSE_CANDIDATE_POOL);
		const keywordHits = searchKeyword(item.query, 0);

		const ctx: AlgorithmContext = {
			query: item.query,
			limit: LIMIT,
			keywordHits,
			denseHits,
			graph,
			documents,
			vaultPath,
			embed: (text) => localEmbedder.embed(text),
			searchVector,
			searchKeyword,
		};
		cachedContexts.set(item.query, ctx);
		return ctx;
	};

	for (const dataset of datasets) {
		const summaries: AlgorithmSummary[] = [];
		for (const algorithm of selectedAlgorithms) {
			summaries.push(await scoreAlgorithm(algorithm, dataset, getContext));
		}
		printDatasetReport(dataset.name, summaries);
	}

	const noAnswerFile = "eval/search/queries-no-answer.jsonl";
	if (
		(values.set === "all" || values.set === "no_answer") &&
		existsSync(noAnswerFile)
	) {
		const noAnswerQueries = await readJsonl(noAnswerFile);
		const answerableQueries = [
			...new Map(
				datasets
					.flatMap((d) => d.queries)
					.filter((q) => resolveRelevant(q, true).length > 0)
					.map((q) => [q.query, q]),
			).values(),
		];

		const posDense: number[] = [];
		const posBm25: number[] = [];
		for (const q of answerableQueries) {
			const ctx = await getContext(q);
			posDense.push(ctx.denseHits[0]?.similarity ?? 0);
			posBm25.push(ctx.keywordHits[0]?.score ?? 0);
		}

		const negDense: number[] = [];
		const negBm25: number[] = [];
		let negWithBm25Hit = 0;
		for (const q of noAnswerQueries) {
			const ctx = await getContext(q);
			const topDense = ctx.denseHits[0]?.similarity ?? 0;
			const topBm = ctx.keywordHits[0]?.score ?? 0;
			negDense.push(topDense);
			negBm25.push(topBm);
			if (topBm > 0) negWithBm25Hit++;
		}

		console.log(
			`\n=== no_answer Rejection Analysis (answerable=${posDense.length}, no_answer=${negDense.length}) ===`,
		);
		console.log(
			`Dense top1 sim  | answerable p10/p50/p90: ${percentile(posDense, 10).toFixed(3)} / ${percentile(posDense, 50).toFixed(3)} / ${percentile(posDense, 90).toFixed(3)} | no_answer: ${percentile(negDense, 10).toFixed(3)} / ${percentile(negDense, 50).toFixed(3)} / ${percentile(negDense, 90).toFixed(3)} | AUROC=${auroc(posDense, negDense).toFixed(3)}`,
		);
		console.log(
			`BM25 top1 score | answerable p10/p50/p90: ${percentile(posBm25, 10).toFixed(2)} / ${percentile(posBm25, 50).toFixed(2)} / ${percentile(posBm25, 90).toFixed(2)} | no_answer non-zero: ${negWithBm25Hit}/${negDense.length} | AUROC=${auroc(posBm25, negBm25).toFixed(3)}`,
		);
		console.log(
			"Threshold (dense < t & bm25 == 0) | no_answer Reject% | answerable False-Reject%",
		);
		for (const t of [0.78, 0.8, 0.82, 0.84, 0.86, 0.88]) {
			const rejectedNeg = negDense.filter(
				(d, i) => d < t && (negBm25[i] ?? 0) === 0,
			).length;
			const falseRejectedPos = posDense.filter(
				(d, i) => d < t && (posBm25[i] ?? 0) === 0,
			).length;
			console.log(
				`${t.toFixed(2).padEnd(33)} | ${((rejectedNeg / negDense.length) * 100).toFixed(1).padStart(16)}% | ${((falseRejectedPos / posDense.length) * 100).toFixed(1).padStart(23)}%`,
			);
		}
	}

	await localModelManager.shutdown();
	process.exit(0);
}

const isEntry = process.argv[1]?.endsWith("compare-algorithms.ts");
if (isEntry) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
