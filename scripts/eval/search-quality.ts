import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import {
	hitAtK,
	mean,
	pairedBootstrap,
	percentile,
	recallAtK,
	reciprocalRankAtK,
} from "./lib/metrics.js";

const { values: args } = parseArgs({
	options: {
		vault: { type: "string" },
		queries: { type: "string", default: "eval/search/queries.jsonl" },
		reps: { type: "string", default: "3" },
		"skip-parity": { type: "boolean", default: false },
		only: { type: "string" },
		"cold-trials": { type: "string", default: "5" },
		"strip-prefix": { type: "boolean", default: false },
		"embed-model": { type: "string" },
		"embed-models-dir": { type: "string" },
		"embed-prefix": { type: "string" },
		out: { type: "string", default: "eval/search/results" },
	},
});
if (!args.vault) {
	console.error("--vault <path> 가 필요합니다.");
	process.exit(1);
}
const vaultPath = resolve(args.vault);
process.env["VAULT_DIR_PATH"] = vaultPath;
const REPS = Number(args.reps);
const LIMIT = 10;
const RRF_K = 60;

const { Indexer } = await import("../../build/shared/indexing/Indexer.js");
const { DirectoryWalker } = await import(
	"../../build/shared/indexing/DirectoryWalker.js"
);
const { Semaphore } = await import("../../build/shared/async/semaphore.js");
const { localEmbedder } = await import(
	"../../build/shared/local-ai/Embedder.js"
);
if (args["strip-prefix"]) {
	const { localEmbedder: embedder } = await import(
		"../../build/shared/local-ai/Embedder.js"
	);
	const rawEmbed = embedder.embed.bind(embedder);
	embedder.embed = (text: string) =>
		rawEmbed(text.replace(/^search_(query|document): /, ""));
}

if (args["embed-model"] || args["embed-models-dir"] || args["embed-prefix"]) {
	const { localEmbedder: overridden } = await import(
		"../../build/shared/local-ai/Embedder.js"
	);
	const { applyEmbedderOverride } = await import("./lib/embedder-override.js");
	applyEmbedderOverride(overridden, {
		modelName: args["embed-model"],
		modelsDir: args["embed-models-dir"],
		prefix: args["embed-prefix"],
	});
}

const { vectorDB } = await import("../../build/shared/indexing/VectorDB.js");
const { VaultManager } = await import(
	"../../build/shared/vault-manager/VaultManager.js"
);
const { localModelManager } = await import(
	"../../build/shared/local-ai/LocalModelManager.js"
);

type Query = {
	id: string;
	type: string;
	query: string;
	relevant: string[];
	note?: string;
};

const queries: Query[] = (await readFile(args.queries as string, "utf-8"))
	.split("\n")
	.filter((line) => line.trim())
	.map((line) => JSON.parse(line));

const missing = queries.flatMap((q) =>
	q.relevant
		.filter((r) => !existsSync(join(vaultPath, r)))
		.map((r) => `${q.id}: ${r}`),
);
if (missing.length > 0) {
	console.error("평가셋의 정답 문서가 Vault에 없습니다:\n", missing.join("\n"));
	process.exit(1);
}

type Chunk = {
	filePath: string;
	content: string;
	_distance: number;
	[key: string]: unknown;
};
type Doc = {
	filePath: string;
	frontmatter: { summary?: string; [key: string]: unknown };
};
type Fused = { score: number; document: Doc; matchedChunks: Chunk[] };

const indexer = new Indexer();
{
	const walker = new DirectoryWalker([".md", ".mdx"]);
	const sem = new Semaphore(10);
	await indexer.build(await walker.walk(vaultPath, sem), sem);
}
const toRel = (p: string) => relative(vaultPath, p);

async function embedQuery(query: string): Promise<number[]> {
	return localEmbedder.embed(query);
}

async function denseChunks(query: string, n: number, exact: boolean) {
	const vector = await embedQuery(query);
	if (!exact) return (await vectorDB.search(vector, n)) as Chunk[];
	const table = await vectorDB.getTable();
	if (!table) return [];
	return (await table
		.vectorSearch(vector)
		.distanceType("cosine")
		.bypassVectorIndex()
		.limit(n)
		.toArray()) as Chunk[];
}

function uniqueDocs(chunks: Chunk[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const c of chunks) {
		if (!seen.has(c.filePath)) {
			seen.add(c.filePath);
			out.push(toRel(c.filePath));
		}
	}
	return out;
}

async function semanticSearch(query: string, limit: number): Promise<Chunk[]> {
	const recallLimit = Math.max(limit * 3, 15);
	return (await denseChunks(query, recallLimit, false)).slice(0, limit);
}

const KEYWORD_FUSION_MIN_RELATIVE_SCORE = 0.7;

async function hybridSearch(query: string, limit: number): Promise<string[]> {
	const semantic = await semanticSearch(query, limit * 3);
	const keyword = indexer
		.searchWithChunks(
			query,
			semantic.length > 0 ? KEYWORD_FUSION_MIN_RELATIVE_SCORE : 0,
		)
		.map((hit: { document: Doc }) => hit.document);

	const scores = new Map<string, Fused>();
	keyword.forEach((doc, index) => {
		scores.set(doc.filePath, {
			score: 1 / (RRF_K + index + 1),
			document: doc,
			matchedChunks: [],
		});
	});
	const seen = new Set<string>();
	let vectorRank = 0;
	for (const chunk of semantic) {
		if (!seen.has(chunk.filePath)) {
			seen.add(chunk.filePath);
			const vectorScore = 1 / (RRF_K + vectorRank + 1);
			const existing = scores.get(chunk.filePath);
			if (existing) {
				existing.score += vectorScore;
				existing.matchedChunks.push(chunk);
			} else {
				const doc = indexer.getDocument(chunk.filePath) as Doc | null;
				if (doc) {
					scores.set(chunk.filePath, {
						score: vectorScore,
						document: doc,
						matchedChunks: [chunk],
					});
				}
			}
			vectorRank++;
		} else {
			scores.get(chunk.filePath)?.matchedChunks.push(chunk);
		}
	}
	return Array.from(scores.values())
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((f) => toRel(f.document.filePath));
}

type Config = {
	name: string;
	description: string;
	run: (q: string) => Promise<string[]>;
};

const configs: Config[] = [
	{
		name: "A_keyword",
		description: "키워드만 (역색인 + IDF)",
		run: async (q) =>
			(indexer.search(q) as Doc[])
				.slice(0, LIMIT)
				.map((d) => toRel(d.filePath)),
	},
	{
		name: "B_dense",
		description: "벡터만 (ANN 인덱스)",
		run: async (q) =>
			uniqueDocs(await denseChunks(q, LIMIT * 9, false)).slice(0, LIMIT),
	},
	{
		name: "B_dense_noprefix",
		description: "벡터만, 질의 접두사(search_query:) 제거",
		run: async (q) => {
			const vector = await localEmbedder.embed(q);
			return uniqueDocs(
				(await vectorDB.search(vector, LIMIT * 9)) as Chunk[],
			).slice(0, LIMIT);
		},
	},
	{
		name: "B_dense_exact",
		description: "벡터만 (인덱스 우회 정확 검색)",
		run: async (q) =>
			uniqueDocs(await denseChunks(q, LIMIT * 9, true)).slice(0, LIMIT),
	},
	{
		name: "E_production",
		description: "현재 동작: 하이브리드 RRF",
		run: (q) => hybridSearch(q, LIMIT),
	},
];

if (args.only) {
	const keep = new Set((args.only as string).split(","));
	configs.splice(0, configs.length, ...configs.filter((c) => keep.has(c.name)));
}

console.error(
	`[eval] 질의 ${queries.length}개, 구성 ${configs.length}개, 반복 ${REPS}회`,
);
await localEmbedder.init();
for (const c of configs) await c.run("워밍업 질의");

type PerQuery = {
	id: string;
	type: string;
	docs: string[];
	recall5: number;
	recall10: number;
	mrr10: number;
	hit1: number;
	latencyMs: number[];
};
const perConfig: Record<string, PerQuery[]> = {};

for (const config of configs) {
	const rows: PerQuery[] = [];
	for (const q of queries) {
		const latencyMs: number[] = [];
		let docs: string[] = [];
		for (let r = 0; r < REPS; r++) {
			const t0 = performance.now();
			docs = await config.run(q.query);
			latencyMs.push(performance.now() - t0);
		}
		rows.push({
			id: q.id,
			type: q.type,
			docs,
			recall5: recallAtK(docs, q.relevant, 5),
			recall10: recallAtK(docs, q.relevant, 10),
			mrr10: reciprocalRankAtK(docs, q.relevant, 10),
			hit1: hitAtK(docs, q.relevant, 1),
			latencyMs,
		});
	}
	perConfig[config.name] = rows;
	await mkdir(args.out as string, { recursive: true });
	await writeFile(
		join(args.out as string, "search-partial.json"),
		JSON.stringify({ perConfig }, null, 2),
	);
	const s = summarize(rows);
	console.error(
		`[eval] ${config.name.padEnd(16)} R@5 ${s.recall5.toFixed(3)} R@10 ${s.recall10.toFixed(3)} MRR ${s.mrr10.toFixed(3)} p50 ${s.p50.toFixed(0)}ms p95 ${s.p95.toFixed(0)}ms`,
	);
}

function summarize(rows: PerQuery[]) {
	const latencies = rows.flatMap((r) => r.latencyMs);
	return {
		n: rows.length,
		recall5: mean(rows.map((r) => r.recall5)),
		recall10: mean(rows.map((r) => r.recall10)),
		mrr10: mean(rows.map((r) => r.mrr10)),
		hit1: mean(rows.map((r) => r.hit1)),
		p50: percentile(latencies, 50),
		p95: percentile(latencies, 95),
	};
}

const types = [...new Set(queries.map((q) => q.type))];
const summary = Object.fromEntries(
	Object.entries(perConfig).map(([name, rows]) => [
		name,
		{
			all: summarize(rows),
			byType: Object.fromEntries(
				types.map((t) => [t, summarize(rows.filter((r) => r.type === t))]),
			),
		},
	]),
);

const comparisons: [string, string, string][] = [
	["A_keyword", "E_production", "현재 동작 vs 키워드만"],
	["B_dense", "E_production", "현재 동작 vs 벡터만"],
	["B_dense", "B_dense_exact", "ANN 근사 손실"],
	["B_dense", "B_dense_noprefix", "질의 접두사 제거 효과"],
];
const paired = comparisons
	.filter(([a, b]) => perConfig[a] && perConfig[b])
	.map(([a, b, label]) => {
		const rowsA = perConfig[a] as PerQuery[];
		const rowsB = perConfig[b] as PerQuery[];
		return {
			label,
			a,
			b,
			recall5: pairedBootstrap(
				rowsA.map((r) => r.recall5),
				rowsB.map((r) => r.recall5),
			),
			mrr10: pairedBootstrap(
				rowsA.map((r) => r.mrr10),
				rowsB.map((r) => r.mrr10),
			),
		};
	});

let parity: Record<string, unknown> | null = null;
let coldSummary: Record<string, number> | null = null;
const cold: { ms: number; semanticFallback: boolean }[] = [];
if (!args["skip-parity"] && perConfig["E_production"]) {
	const vm = new VaultManager(vaultPath);
	await vm.initialize();
	for (let i = 0; i < 20; i++) {
		await vm.hybridSearch("워밍업 질의", LIMIT);
		if (localModelManager.isEmbedderReady) break;
		await new Promise((r) => setTimeout(r, 500));
	}
	const parityRows: { id: string; same: boolean; top5Same: boolean }[] = [];
	const prodLatency: number[] = [];
	for (const q of queries) {
		let docs: string[] = [];
		for (let r = 0; r < REPS; r++) {
			const t0 = performance.now();
			const { results } = await vm.hybridSearch(q.query, LIMIT);
			prodLatency.push(performance.now() - t0);
			docs = results.map((x: { document: Doc }) => toRel(x.document.filePath));
		}
		const mine = (perConfig["E_production"] as PerQuery[]).find(
			(r) => r.id === q.id,
		)?.docs as string[];
		parityRows.push({
			id: q.id,
			same: JSON.stringify(docs) === JSON.stringify(mine),
			top5Same:
				JSON.stringify(docs.slice(0, 5)) === JSON.stringify(mine.slice(0, 5)),
		});
	}
	parity = {
		exactListMatch: mean(parityRows.map((r) => (r.same ? 1 : 0))),
		top5Match: mean(parityRows.map((r) => (r.top5Same ? 1 : 0))),
		mismatched: parityRows.filter((r) => !r.same).map((r) => r.id),
		warmLatencyMs: {
			p50: percentile(prodLatency, 50),
			p95: percentile(prodLatency, 95),
		},
	};
	console.error("[parity]", JSON.stringify(parity));

	const coldTrials = Number(args["cold-trials"]);
	for (let i = 0; i < coldTrials; i++) {
		localModelManager.beginToolCall();
		await localModelManager.endToolCall();
		const q = queries[i % queries.length] as Query;
		const t0 = performance.now();
		const { search_status } = await vm.hybridSearch(q.query, LIMIT);
		cold.push({
			ms: performance.now() - t0,
			semanticFallback: search_status.reason === "semantic_unavailable",
		});
		for (let w = 0; w < 60 && !localModelManager.isEmbedderReady; w++) {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	coldSummary = {
		trials: cold.length,
		p50Ms: percentile(
			cold.map((c) => c.ms),
			50,
		),
		maxMs: Math.max(...cold.map((c) => c.ms)),
		keywordOnlyFallbackRate: mean(
			cold.map((c) => (c.semanticFallback ? 1 : 0)),
		),
	};
	console.error("[cold]", JSON.stringify(coldSummary));
}
const judgedRows = (perConfig["E_production"] ??
	Object.values(perConfig).at(-1) ??
	[]) as PerQuery[];
const unjudged = queries.map((q) => {
	const rows = judgedRows;
	const docs = rows.find((r) => r.id === q.id)?.docs ?? [];
	return {
		id: q.id,
		query: q.query,
		unjudgedTop5: docs.slice(0, 5).filter((d) => !q.relevant.includes(d)),
	};
});
const judgedAt5 = mean(
	queries.map((q) => {
		const docs = judgedRows.find((r) => r.id === q.id)?.docs ?? [];
		const top = docs.slice(0, 5);
		return top.length === 0
			? 1
			: top.filter((d) => q.relevant.includes(d)).length / top.length;
	}),
);

const table = await vectorDB.getTable();
const chunkRows = table ? await table.countRows() : 0;
const indices = table ? await table.listIndices() : [];

const result = {
	environment: {
		date: new Date().toISOString(),
		node: process.version,
		platform: `${process.platform}-${process.arch}`,
		cpu: cpus()[0]?.model,
		cores: cpus().length,
		memoryGB: Math.round(totalmem() / 1024 ** 3),
		documents: indexer.getAllDocuments().length,
		chunks: chunkRows,
		vectorIndexes: indices.map(
			(i: { name: string; indexType: string }) => `${i.name}:${i.indexType}`,
		),
		embedder: localEmbedder.modelName,
		embedderOverride: {
			model: args["embed-model"] ?? null,
			prefix: args["embed-prefix"] ?? null,
		},
		stripPrefix: Boolean(args["strip-prefix"]),
		limit: LIMIT,
		reps: REPS,
	},
	queries: {
		total: queries.length,
		byType: Object.fromEntries(
			types.map((t) => [t, queries.filter((q) => q.type === t).length]),
		),
	},
	configs: configs.map((c) => ({ name: c.name, description: c.description })),
	summary,
	paired,
	parity,
	cold: { ...coldSummary, trials: cold },
	judgedAt5E: judgedAt5,
	perQuery: perConfig,
};

await mkdir(args.out as string, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = join(args.out as string, `search-${stamp}.json`);
await writeFile(outFile, JSON.stringify(result, null, 2));
await writeFile(
	join(args.out as string, `search-${stamp}-unjudged.jsonl`),
	`${unjudged.map((u) => JSON.stringify(u)).join("\n")}\n`,
);
console.error(`\n결과 저장: ${outFile}`);
await localModelManager.shutdown();
process.exit(0);
