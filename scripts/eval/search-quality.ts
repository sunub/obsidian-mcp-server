/**
 * 검색 품질 평가 (docs/search-quality-evaluation.md 2.2~2.3).
 *
 * 같은 평가셋으로 구성별 순위를 만들고 Recall@5/10, MRR@10, Hit@1, 지연(p50/p95)을 계산한다.
 *   A        키워드만 (Indexer.search)
 *   B        벡터만 (LanceDB ANN 인덱스)
 *   B_exact  벡터만 (인덱스를 우회한 정확 검색) - ANN(IVF-PQ) 근사 손실 확인용
 *   C        하이브리드 RRF, 리랭커 없음
 *   D        하이브리드 RRF + 리랭커 항상 실행
 *   E        현재 동작: 거리 < 0.2 이면 리랭커 건너뜀 (VaultManager.hybridSearch 재현)
 *   E@t      건너뛰기 임계값 스윕
 * E의 재현이 실제 VaultManager.hybridSearch와 같은 결과를 내는지 질의별로 대조한다(parity).
 *
 * 사용법 (빌드 결과물 사용: 먼저 `npx tsc && npx tsc-alias`, 벡터 인덱스는 indexing-benchmark --rag 로 생성)
 *   npx tsx scripts/eval/search-quality.ts --vault <복사본 Vault> [--queries eval/search/queries.jsonl] [--reps 3]
 */
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
		"rerank-reps": { type: "string", default: "1" },
		"latency-queries": { type: "string", default: "10" },
		"rerank-cache": { type: "string" },
		sweep: { type: "string", default: "0.1,0.15,0.25,0.3,0.4" },
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
// 리랭커가 들어간 구성은 질의당 수 초가 걸리므로 반복 횟수를 따로 둔다
const RERANK_REPS = Number(args["rerank-reps"]);
// 리랭커 구성의 지연은 앞쪽 N개 질의에서만 캐시 없이 측정하고, 나머지는 캐시로 품질만 계산한다
const LATENCY_QUERIES = Number(args["latency-queries"]);
const LIMIT = 10; // search 도구 기본값 (src/tools/vault/utils/actions/search.ts)
const RRF_K = 60;
const PROD_THRESHOLD = 0.2;
const SWEEP = (args.sweep as string).split(",").filter(Boolean).map(Number);

const { Indexer } = await import("../../build/utils/Indexer.js");
const { DirectoryWalker } = await import(
	"../../build/utils/DirectoryWalker.js"
);
const { Semaphore } = await import("../../build/utils/semaphore.js");
const { localEmbedder } = await import("../../build/utils/Embedder.js");
// --strip-prefix: nomic 계열 규칙인 "search_query: " / "search_document: " 접두사를 떼고 임베딩한다.
// 현재 임베딩 모델(paraphrase-multilingual-MiniLM)은 이 접두사를 학습하지 않았으므로 효과를 비교하기 위한 실험 옵션이다.
// 소스 코드를 바꾸지 않고, 같은 프로세스의 localEmbedder.embed만 감싼다.
if (args["strip-prefix"]) {
	const { localEmbedder: embedder } = await import(
		"../../build/utils/Embedder.js"
	);
	const rawEmbed = embedder.embed.bind(embedder);
	embedder.embed = (text: string) =>
		rawEmbed(text.replace(/^search_(query|document): /, ""));
}

if (args["embed-model"] || args["embed-models-dir"] || args["embed-prefix"]) {
	const { localEmbedder: overridden } = await import(
		"../../build/utils/Embedder.js"
	);
	const { applyEmbedderOverride } = await import("./lib/embedder-override.js");
	applyEmbedderOverride(overridden, {
		modelName: args["embed-model"],
		modelsDir: args["embed-models-dir"],
		prefix: args["embed-prefix"],
	});
}

const { localReranker } = await import("../../build/utils/LocalReranker.js");
const { vectorDB } = await import("../../build/utils/VectorDB.js");
const { VaultManager } = await import(
	"../../build/utils/VaultManger/VaultManager.js"
);
const { localModelManager } = await import(
	"../../build/utils/LocalModelManager.js"
);

// ---------- 평가셋 ----------

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

// ---------- 검색 구성요소 (VaultManager와 같은 모듈 사용) ----------

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
type Trace = { chunkRerank: boolean; fusedRerank: boolean };

const indexer = new Indexer();
{
	const walker = new DirectoryWalker([".md", ".mdx"]);
	const sem = new Semaphore(10);
	await indexer.build(await walker.walk(vaultPath, sem), sem);
}
const toRel = (p: string) => relative(vaultPath, p);

async function embedQuery(query: string): Promise<number[]> {
	return localEmbedder.embed(`search_query: ${query}`);
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

const normalize = (text: string) =>
	text
		.replace(/\r\n|\r|\n/g, " ")
		.replace(/\s+/g, " ")
		.trim();

/** VaultManager.safeSemanticSearch 재현. threshold=null 이면 리랭커 항상 실행, rerank=false 면 실행 안 함 */
type HybridOpts = {
	rerank: boolean;
	threshold: number | null;
	/** 청크 단계 리랭커 사용 여부 (기본 true = 현재 코드) */
	chunkRerank?: boolean;
	/** 결합 단계 리랭커 입력: legacy = 첫 청크 → summary → 파일 경로 (현재 코드), excerpt = 첫 청크 → 문서 본문 앞부분 */
	fusedText?: "legacy" | "excerpt";
};

const EXCERPT_CHARS = 1500;
const excerptCache = new Map<string, string>();
async function documentExcerpt(filePath: string): Promise<string> {
	const cached = excerptCache.get(filePath);
	if (cached !== undefined) return cached;
	const raw = await readFile(filePath, "utf-8");
	const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
	const excerpt = body.slice(0, EXCERPT_CHARS);
	excerptCache.set(filePath, excerpt);
	return excerpt;
}

async function semanticSearch(
	query: string,
	limit: number,
	opts: HybridOpts,
	trace: Trace,
): Promise<Chunk[]> {
	const recallLimit = Math.max(limit * 3, 15);
	const initial = await denseChunks(query, recallLimit, false);
	if (initial.length === 0) return [];
	if (!opts.rerank || opts.chunkRerank === false)
		return initial.slice(0, limit);
	const first = initial[0] as Chunk;
	if (opts.threshold !== null && first._distance < opts.threshold) {
		return initial.slice(0, limit);
	}
	trace.chunkRerank = true;
	const documents = initial.map((r) => r.content);
	const reranked = await localReranker.rerank(query, documents);
	return reranked
		.slice(0, limit)
		.map((r: { document: string }) => {
			const target = normalize(r.document);
			return initial[documents.findIndex((d) => normalize(d) === target)];
		})
		.filter((r: Chunk | undefined): r is Chunk => r !== undefined);
}

/** VaultManager.hybridSearch 재현 */
async function hybridSearch(
	query: string,
	limit: number,
	opts: HybridOpts,
): Promise<{ docs: string[]; trace: Trace }> {
	const trace: Trace = { chunkRerank: false, fusedRerank: false };
	const keyword = indexer.search(query) as Doc[];
	const semantic = await semanticSearch(query, limit * 3, opts, trace);

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
	const fused = Array.from(scores.values())
		.sort((a, b) => b.score - a.score)
		.slice(0, limit * 2);

	let final: Fused[] = fused;
	const legacyText = (f: Fused) =>
		f.matchedChunks[0]?.content ||
		(f.document.frontmatter.summary as string | undefined) ||
		f.document.filePath;
	const hasHighlyRelevant =
		opts.threshold !== null &&
		fused.some((item) =>
			item.matchedChunks.some(
				(c) =>
					typeof c._distance === "number" &&
					c._distance < (opts.threshold as number),
			),
		);
	if (opts.rerank && !hasHighlyRelevant && semantic.length > 0) {
		trace.fusedRerank = true;
		if (opts.fusedText === "excerpt") {
			// 후보마다 채점할 본문을 만들고, 텍스트가 겹쳐도 후보를 잃지 않도록 인덱스로 되돌린다
			const texts = await Promise.all(
				fused.map(
					async (f) =>
						f.matchedChunks[0]?.content ??
						(await documentExcerpt(f.document.filePath)),
				),
			);
			const reranked = await localReranker.rerank(query, texts);
			const pending = new Map<string, number[]>();
			texts.forEach((t, i) => {
				pending.set(t, [...(pending.get(t) ?? []), i]);
			});
			final = reranked
				.map((r: { document: string }) => {
					const index = pending.get(r.document)?.shift();
					return index === undefined ? undefined : fused[index];
				})
				.filter((f: Fused | undefined): f is Fused => f !== undefined);
		} else {
			const reranked = await localReranker.rerank(query, fused.map(legacyText));
			final = reranked
				.map((r: { document: string }) =>
					fused.find((f) => legacyText(f) === r.document),
				)
				.filter((f: Fused | undefined): f is Fused => f !== undefined);
		}
	}
	return {
		docs: final.slice(0, limit).map((f) => toRel(f.document.filePath)),
		trace,
	};
}

// ---------- 리랭커 캐시 ----------
// 같은 (질의, 후보 목록)에 대한 리랭커 점수는 결정적이다. 임계값 스윕 구성은 캐시를 읽어
// 품질만 계산하고, 지연은 캐시를 쓰지 않는 D/E 구성에서만 측정한다.
const rerankCache = new Map<string, { document: string; score: number }[]>();
let readCache = false;
const cacheFile = args["rerank-cache"] as string | undefined;
if (cacheFile && existsSync(cacheFile)) {
	const saved = JSON.parse(await readFile(cacheFile, "utf-8")) as [
		string,
		{ document: string; score: number }[],
	][];
	for (const [k, v] of saved) rerankCache.set(k, v);
	console.error(`[eval] 리랭커 캐시 ${rerankCache.size}건 불러옴`);
}
async function saveCache() {
	if (cacheFile) await writeFile(cacheFile, JSON.stringify([...rerankCache]));
}
const rawRerank = localReranker.rerank.bind(localReranker);
localReranker.rerank = async (query: string, documents: string[]) => {
	const key = `${query}\u0000${JSON.stringify(documents)}`;
	const hit = rerankCache.get(key);
	if (readCache && hit) return hit.map((r) => ({ ...r }));
	const result = await rawRerank(query, documents);
	rerankCache.set(
		key,
		result.map((r: { document: string; score: number }) => ({ ...r })),
	);
	return result;
};

// ---------- 구성 정의 ----------

type Config = {
	name: string;
	description: string;
	/** "fast": 반복 측정, "rerank": 1회 측정, "cached": 리랭커 캐시 사용(지연 측정 안 함) */
	kind: "fast" | "rerank" | "cached";
	run: (q: string) => Promise<{ docs: string[]; trace?: Trace }>;
};

const configs: Config[] = [
	{
		name: "A_keyword",
		description: "키워드만 (역색인 + IDF)",
		kind: "fast",
		run: async (q) => ({
			docs: (indexer.search(q) as Doc[])
				.slice(0, LIMIT)
				.map((d) => toRel(d.filePath)),
		}),
	},
	{
		name: "B_dense",
		description: "벡터만 (ANN 인덱스)",
		kind: "fast",
		run: async (q) => ({
			docs: uniqueDocs(await denseChunks(q, LIMIT * 9, false)).slice(0, LIMIT),
		}),
	},
	{
		name: "B_dense_noprefix",
		description: "벡터만, 질의 접두사(search_query:) 제거",
		kind: "fast",
		run: async (q) => {
			const vector = await localEmbedder.embed(q);
			return {
				docs: uniqueDocs(
					(await vectorDB.search(vector, LIMIT * 9)) as Chunk[],
				).slice(0, LIMIT),
			};
		},
	},
	{
		name: "B_dense_exact",
		description: "벡터만 (인덱스 우회 정확 검색)",
		kind: "fast",
		run: async (q) => ({
			docs: uniqueDocs(await denseChunks(q, LIMIT * 9, true)).slice(0, LIMIT),
		}),
	},
	{
		name: "C_hybrid",
		description: "하이브리드 RRF, 리랭커 없음",
		kind: "fast",
		run: (q) => hybridSearch(q, LIMIT, { rerank: false, threshold: null }),
	},
	{
		name: "D_hybrid_rerank",
		description: "하이브리드 RRF + 리랭커 항상 실행",
		kind: "rerank",
		run: (q) => hybridSearch(q, LIMIT, { rerank: true, threshold: null }),
	},
	{
		// 실제 VaultManager.hybridSearch를 재현한다. 코드가 바뀌면 이 정의도 함께 바꾸고
		// parity 결과로 둘이 같은지 확인한다.
		name: "E_production",
		description: "현재 동작: 하이브리드 RRF, 리랭커 없음 (2026-09-28 수정 후)",
		kind: "fast",
		run: (q) => hybridSearch(q, LIMIT, { rerank: false, threshold: null }),
	},
	{
		name: "E_legacy",
		description: `수정 전 동작: 거리 < ${PROD_THRESHOLD} 이면 리랭커 건너뜀`,
		kind: "rerank",
		run: (q) =>
			hybridSearch(q, LIMIT, { rerank: true, threshold: PROD_THRESHOLD }),
	},
	{
		name: "F_fused_rerank_excerpt",
		description: "청크 리랭커 제거, 결합 리랭커 입력을 본문으로 수정",
		kind: "rerank",
		run: (q) =>
			hybridSearch(q, LIMIT, {
				rerank: true,
				threshold: null,
				chunkRerank: false,
				fusedText: "excerpt",
			}),
	},
	{
		name: "G_both_rerank_excerpt",
		description: "두 단계 리랭커 유지, 결합 리랭커 입력을 본문으로 수정",
		kind: "rerank",
		run: (q) =>
			hybridSearch(q, LIMIT, {
				rerank: true,
				threshold: null,
				chunkRerank: true,
				fusedText: "excerpt",
			}),
	},
	...SWEEP.map((t) => ({
		name: `E@${t}`,
		description: `건너뛰기 임계값 ${t}`,
		kind: "cached" as const,
		run: (q: string) => hybridSearch(q, LIMIT, { rerank: true, threshold: t }),
	})),
];

// --only A_keyword,C_hybrid 처럼 일부 구성만 실행
if (args.only) {
	const keep = new Set((args.only as string).split(","));
	configs.splice(0, configs.length, ...configs.filter((c) => keep.has(c.name)));
}

// ---------- 실행 ----------

console.error(
	`[eval] 질의 ${queries.length}개, 구성 ${configs.length}개, 반복 ${REPS}회`,
);
await localEmbedder.init();
await localReranker.init();
// 워밍업 (모델 로딩을 측정에서 제외)
for (const c of configs.filter((c) => c.kind === "fast"))
	await c.run("워밍업 질의");
await localReranker.rerank("워밍업 질의", ["워밍업 문서"]);

type PerQuery = {
	id: string;
	type: string;
	docs: string[];
	recall5: number;
	recall10: number;
	mrr10: number;
	hit1: number;
	latencyMs: number[];
	trace?: Trace;
};
const perConfig: Record<string, PerQuery[]> = {};

for (const config of configs) {
	const rows: PerQuery[] = [];
	const reps = config.kind === "fast" ? REPS : RERANK_REPS;
	for (const [qi, q] of queries.entries()) {
		const latencyMs: number[] = [];
		let result: { docs: string[]; trace?: Trace } = { docs: [] };
		// 지연을 재는 질의는 캐시를 읽지 않는다
		const measure =
			config.kind === "fast" ||
			(config.kind === "rerank" && qi < LATENCY_QUERIES);
		readCache = !measure;
		for (let r = 0; r < (measure ? reps : 1); r++) {
			const t0 = performance.now();
			result = await config.run(q.query);
			if (measure) latencyMs.push(performance.now() - t0);
		}
		rows.push({
			id: q.id,
			type: q.type,
			docs: result.docs,
			recall5: recallAtK(result.docs, q.relevant, 5),
			recall10: recallAtK(result.docs, q.relevant, 10),
			mrr10: reciprocalRankAtK(result.docs, q.relevant, 10),
			hit1: hitAtK(result.docs, q.relevant, 1),
			latencyMs,
			trace: result.trace,
		});
	}
	perConfig[config.name] = rows;
	readCache = false;
	await saveCache();
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
	const withTrace = rows.filter((r) => r.trace);
	return {
		n: rows.length,
		recall5: mean(rows.map((r) => r.recall5)),
		recall10: mean(rows.map((r) => r.recall10)),
		mrr10: mean(rows.map((r) => r.mrr10)),
		hit1: mean(rows.map((r) => r.hit1)),
		p50: percentile(latencies, 50),
		p95: percentile(latencies, 95),
		fusedRerankRate:
			withTrace.length > 0
				? mean(withTrace.map((r) => (r.trace?.fusedRerank ? 1 : 0)))
				: null,
		chunkRerankRate:
			withTrace.length > 0
				? mean(withTrace.map((r) => (r.trace?.chunkRerank ? 1 : 0)))
				: null,
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

// ---------- 짝지은 비교 (부트스트랩 95% CI) ----------

const comparisons: [string, string, string][] = [
	["A_keyword", "C_hybrid", "하이브리드 결합 효과 (키워드 대비)"],
	["B_dense", "C_hybrid", "하이브리드 결합 효과 (벡터 대비)"],
	["B_dense", "B_dense_exact", "ANN 근사 손실"],
	["B_dense", "B_dense_noprefix", "질의 접두사 제거 효과"],
	["C_hybrid", "D_hybrid_rerank", "리랭커 효과"],
	["D_hybrid_rerank", "E_legacy", "건너뛰기 규칙의 품질 비용"],
	["B_dense", "E_production", "현재 동작 vs 벡터만"],
	["A_keyword", "E_production", "현재 동작 vs 키워드만"],
	["E_legacy", "E_production", "수정 전 → 수정 후 (같은 인덱스)"],
	["E_legacy", "F_fused_rerank_excerpt", "리랭커 입력 수정 (결합 단계만)"],
	["E_legacy", "G_both_rerank_excerpt", "리랭커 입력 수정 (두 단계)"],
	["C_hybrid", "F_fused_rerank_excerpt", "입력을 고친 리랭커의 효과"],
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

// ---------- parity: 재현(E)과 실제 VaultManager.hybridSearch 대조 ----------

let parity: Record<string, unknown> | null = null;
let coldSummary: Record<string, number> | null = null;
const cold: { ms: number; semanticFallback: boolean }[] = [];
if (!args["skip-parity"] && perConfig["E_production"]) {
	// 실제 경로 대조: 앞쪽 N개 질의는 캐시 없이 지연까지 재고, 나머지는 캐시로 순위만 대조한다
	const vm = new VaultManager(vaultPath);
	await vm.initialize();
	// withEmbedder/withReranker가 준비될 때까지 워밍업
	for (let i = 0; i < 20; i++) {
		await vm.hybridSearch("워밍업 질의", LIMIT);
		if (localModelManager.isEmbedderReady && localModelManager.isRerankerReady)
			break;
		await new Promise((r) => setTimeout(r, 500));
	}
	const parityRows: { id: string; same: boolean; top5Same: boolean }[] = [];
	const prodLatency: number[] = [];
	for (const [qi, q] of queries.entries()) {
		let docs: string[] = [];
		const measure = qi < LATENCY_QUERIES;
		readCache = !measure;
		for (let r = 0; r < (measure ? RERANK_REPS : 1); r++) {
			const t0 = performance.now();
			const { results } = await vm.hybridSearch(q.query, LIMIT);
			if (measure) prodLatency.push(performance.now() - t0);
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
	readCache = false;
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

	// ---------- cold: 모델이 내려간 상태에서의 첫 검색 ----------

	const coldTrials = Number(args["cold-trials"]);
	for (let i = 0; i < coldTrials; i++) {
		// 도구 호출이 끝나면 모델을 내리는 실제 경로(endToolCall)를 그대로 사용
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
// ---------- 판정되지 않은 상위 결과 (사람 검토용) ----------

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

// ---------- 인덱스 정보 ----------

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
		reranker: localReranker.modelName,
		limit: LIMIT,
		reps: REPS,
		rerankReps: RERANK_REPS,
		latencyQueries: LATENCY_QUERIES,
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
