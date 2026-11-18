/**
 * ANN 인덱스(IVF-PQ) 재생성에 따른 검색 품질 흔들림 측정 (docs/search-quality-evaluation.md 4.7, 4.8).
 *
 * 임베딩과 청크는 그대로 두고 벡터 인덱스만 N번 다시 만든다. 매번 같은 질의로 두 가지를 비교한다.
 *   ANN    인덱스를 쓰는 검색 (vectorDB.search: nprobes 20, refineFactor 1, 실제 운영 경로)
 *   EXACT  인덱스를 우회한 정확 검색 (bypassVectorIndex). 인덱스와 무관하므로 매번 같아야 한다.
 *
 * 해석:
 *   - ANN의 MRR이 재생성마다 달라지면 흔들림의 원인은 인덱스 학습(k-means)이다.
 *   - EXACT의 MRR이 재생성마다 달라지면 인덱스가 원인이 아니므로 측정 자체를 의심해야 한다(대조군).
 *   - ANN 평균과 EXACT의 차이는 근사 검색이 품질에 주는 손실이다.
 *
 * 사전 준비 (벡터가 이미 색인돼 있어야 한다. 이 스크립트는 임베딩을 다시 만들지 않는다):
 *   npm run build
 *   npx tsx scripts/eval/indexing-benchmark.ts --vault <복사본 Vault> --rag --runs 1 --allow-reset
 *
 * 사용법 (빌드 결과물 사용):
 *   npx tsx scripts/eval/ann-variance.ts --vault <복사본 Vault> [--rebuilds 5] [--queries eval/search/queries.jsonl]
 *
 * 주의: 벡터 인덱스를 교체한다(벡터 행은 지우지 않는다). 복사본 Vault에서만 실행한다.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	mean,
	pairedBootstrap,
	recallAtK,
	reciprocalRankAtK,
} from "./lib/metrics.js";

const { values: args } = parseArgs({
	options: {
		vault: { type: "string" },
		queries: { type: "string", default: "eval/search/queries.jsonl" },
		rebuilds: { type: "string", default: "5" },
		out: { type: "string", default: "eval/search/results/ann-variance" },
		"allow-reset": { type: "boolean", default: false },
	},
});
if (!args.vault) {
	console.error("--vault <path> 가 필요합니다.");
	process.exit(1);
}
const vaultPath = resolve(args.vault);
if (!args["allow-reset"] && !/scratch|eval/i.test(vaultPath)) {
	console.error(
		`벡터 인덱스를 교체합니다. 복사본 Vault가 아니라면 실행하지 마세요: ${vaultPath}\n(복사본이 맞다면 --allow-reset)`,
	);
	process.exit(1);
}
process.env["VAULT_DIR_PATH"] = vaultPath;

const REBUILDS = Number(args.rebuilds);
if (!Number.isInteger(REBUILDS) || REBUILDS < 2) {
	console.error("--rebuilds 는 2 이상의 정수여야 합니다.");
	process.exit(1);
}
const LIMIT = 10; // search 도구 기본값
const RRF_K = 60;
// VaultManager.hybridSearch와 같은 후보 수: 청크 limit*9개를 받아 limit*3개로 자른다
const DENSE_RECALL = LIMIT * 9;
const DENSE_USED = LIMIT * 3;

const { Indexer } = await import("../../build/utils/Indexer.js");
const { DirectoryWalker } = await import(
	"../../build/utils/DirectoryWalker.js"
);
const { Semaphore } = await import("../../build/utils/semaphore.js");
const { localEmbedder } = await import("../../build/utils/Embedder.js");
const { vectorDB } = await import("../../build/utils/VectorDB.js");

// ---------- 평가셋 ----------

type Query = { id: string; type: string; query: string; relevant: string[] };

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

// ---------- 검색 구성요소 ----------

type Chunk = { id?: string; filePath: string; [key: string]: unknown };
type Doc = { filePath: string };

const indexer = new Indexer();
{
	const walker = new DirectoryWalker([".md", ".mdx"]);
	const sem = new Semaphore(10);
	await indexer.build(await walker.walk(vaultPath, sem), sem);
}
const toRel = (p: string) => relative(vaultPath, p);

const maybeTable = await vectorDB.getTable();
if (!maybeTable) {
	console.error(
		"벡터 테이블이 없습니다. 먼저 indexing-benchmark --rag 로 색인하세요.",
	);
	process.exit(1);
}
const table = maybeTable;
const rowCount = await table.countRows();
if (rowCount < 256) {
	console.error(
		`벡터 행이 ${rowCount}개입니다. 256개 미만이면 인덱스가 만들어지지 않아 실험이 의미 없습니다.`,
	);
	process.exit(1);
}

// 질의 벡터는 결정적이므로 한 번만 계산해 모든 재생성과 두 경로에 같이 쓴다.
// 운영 경로(VaultManager)와 같이 접두사 없이 질의 그대로 임베딩한다.
console.error(`[ann-variance] 질의 ${queries.length}개 임베딩 중...`);
const queryVectors = new Map<string, number[]>();
for (const q of queries) {
	queryVectors.set(q.id, await localEmbedder.embed(q.query));
}

async function denseChunks(queryId: string, exact: boolean): Promise<Chunk[]> {
	const vector = queryVectors.get(queryId) as number[];
	if (!exact) return (await vectorDB.search(vector, DENSE_RECALL)) as Chunk[];
	return (await table
		.vectorSearch(vector)
		.distanceType("cosine")
		.bypassVectorIndex()
		.limit(DENSE_RECALL)
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

/** 키워드 순위와 벡터 순위를 RRF로 결합한다 (VaultManager.hybridSearch에서 리랭커를 뺀 경로) */
function fuse(keyword: Doc[], semantic: Chunk[]): string[] {
	const scores = new Map<string, number>();
	keyword.forEach((doc, index) => {
		scores.set(doc.filePath, 1 / (RRF_K + index + 1));
	});
	const seen = new Set<string>();
	let vectorRank = 0;
	for (const chunk of semantic) {
		if (seen.has(chunk.filePath)) continue;
		seen.add(chunk.filePath);
		const add = 1 / (RRF_K + vectorRank + 1);
		const existing = scores.get(chunk.filePath);
		if (existing !== undefined) {
			scores.set(chunk.filePath, existing + add);
		} else if (indexer.getDocument(chunk.filePath)) {
			scores.set(chunk.filePath, add);
		}
		vectorRank++;
	}
	return Array.from(scores.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, LIMIT)
		.map(([filePath]) => toRel(filePath));
}

// ---------- 한 경로의 질의별 결과 ----------

type PerQuery = {
	id: string;
	type: string;
	vectorDocs: string[];
	hybridDocs: string[];
	vectorRR: number;
	hybridRR: number;
	vectorR5: number;
	hybridR5: number;
	topChunkIds: string[];
};

async function evaluate(exact: boolean): Promise<PerQuery[]> {
	const rows: PerQuery[] = [];
	for (const q of queries) {
		const chunks = await denseChunks(q.id, exact);
		const vectorDocs = uniqueDocs(chunks).slice(0, LIMIT);
		const keyword = indexer.search(q.query) as Doc[];
		const hybridDocs = fuse(keyword, chunks.slice(0, DENSE_USED));
		rows.push({
			id: q.id,
			type: q.type,
			vectorDocs,
			hybridDocs,
			vectorRR: reciprocalRankAtK(vectorDocs, q.relevant, LIMIT),
			hybridRR: reciprocalRankAtK(hybridDocs, q.relevant, LIMIT),
			vectorR5: recallAtK(vectorDocs, q.relevant, 5),
			hybridR5: recallAtK(hybridDocs, q.relevant, 5),
			topChunkIds: chunks
				.slice(0, DENSE_USED)
				.map((c) => String(c.id ?? `${c.filePath}`)),
		});
	}
	return rows;
}

const avg = (rows: PerQuery[], pick: (r: PerQuery) => number) =>
	mean(rows.map(pick));

/** 정확 검색 상위 청크 중 ANN 상위에도 있는 비율 (근사 검색의 후보 재현율) */
function chunkOverlap(ann: PerQuery[], exact: PerQuery[]): number {
	return mean(
		ann.map((a, i) => {
			const truth = new Set((exact[i] as PerQuery).topChunkIds);
			if (truth.size === 0) return 1;
			const hit = a.topChunkIds.filter((id) => truth.has(id)).length;
			return hit / truth.size;
		}),
	);
}

const sameList = (a: string[], b: string[]) =>
	JSON.stringify(a) === JSON.stringify(b);

// ---------- 실험: 인덱스만 N번 재생성 ----------

type Run = {
	run: number;
	indexCount: number;
	ann: {
		vectorMRR: number;
		hybridMRR: number;
		vectorR5: number;
		hybridR5: number;
	};
	exact: {
		vectorMRR: number;
		hybridMRR: number;
		vectorR5: number;
		hybridR5: number;
	};
	chunkOverlap: number;
	/** 정확 검색과 상위 10개 문서 목록이 다른 질의 수 (벡터만 / 하이브리드) */
	vectorDiffersFromExact: number;
	hybridDiffersFromExact: number;
};

const runs: Run[] = [];
const annRuns: PerQuery[][] = [];
const exactRuns: PerQuery[][] = [];

for (let i = 1; i <= REBUILDS; i++) {
	const t0 = performance.now();
	await vectorDB.createVectorIndex(); // 운영과 같은 설정(IVF-PQ, √N 파티션)으로 다시 학습
	const buildMs = Math.round(performance.now() - t0);
	// createVectorIndex는 자기 핸들로 커밋하므로 새로 열어서 점검한다
	const indices = await ((await vectorDB.getTable()) ?? table).listIndices();

	const ann = await evaluate(false);
	const exact = await evaluate(true);
	annRuns.push(ann);
	exactRuns.push(exact);

	const summarize = (rows: PerQuery[]) => ({
		vectorMRR: avg(rows, (r) => r.vectorRR),
		hybridMRR: avg(rows, (r) => r.hybridRR),
		vectorR5: avg(rows, (r) => r.vectorR5),
		hybridR5: avg(rows, (r) => r.hybridR5),
	});
	const run: Run = {
		run: i,
		indexCount: indices.length,
		ann: summarize(ann),
		exact: summarize(exact),
		chunkOverlap: chunkOverlap(ann, exact),
		vectorDiffersFromExact: ann.filter(
			(a, k) => !sameList(a.vectorDocs, (exact[k] as PerQuery).vectorDocs),
		).length,
		hybridDiffersFromExact: ann.filter(
			(a, k) => !sameList(a.hybridDocs, (exact[k] as PerQuery).hybridDocs),
		).length,
	};
	runs.push(run);
	console.error(
		`[ann-variance] ${i}/${REBUILDS} 인덱스 ${buildMs}ms, 인덱스 ${indices.length}개, ` +
			`벡터 MRR ANN ${run.ann.vectorMRR.toFixed(3)} / EXACT ${run.exact.vectorMRR.toFixed(3)}, ` +
			`하이브리드 MRR ANN ${run.ann.hybridMRR.toFixed(3)} / EXACT ${run.exact.hybridMRR.toFixed(3)}`,
	);
}

// ---------- 요약 ----------

const stats = (values: number[]) => {
	const m = mean(values);
	const sd = Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
	return { mean: m, sd, min: Math.min(...values), max: Math.max(...values) };
};
const fmt = (s: ReturnType<typeof stats>) =>
	`${s.mean.toFixed(3)} (${s.min.toFixed(3)}~${s.max.toFixed(3)}, 표준편차 ${s.sd.toFixed(3)})`;

const summary = {
	vectorMRR: {
		ann: stats(runs.map((r) => r.ann.vectorMRR)),
		exact: stats(runs.map((r) => r.exact.vectorMRR)),
	},
	hybridMRR: {
		ann: stats(runs.map((r) => r.ann.hybridMRR)),
		exact: stats(runs.map((r) => r.exact.hybridMRR)),
	},
	chunkOverlap: stats(runs.map((r) => r.chunkOverlap)),
};

// 재생성 사이에 ANN 결과가 바뀐 질의: 어떤 두 재생성에서라도 상위 10개 목록이 다르면 불안정
const unstable = (pick: (r: PerQuery) => string[]) =>
	queries
		.filter((_, k) => {
			const first = pick(annRuns[0]?.[k] as PerQuery);
			return annRuns.some((run) => !sameList(pick(run[k] as PerQuery), first));
		})
		.map((q) => q.id);
const unstableVector = unstable((r) => r.vectorDocs);
const unstableHybrid = unstable((r) => r.hybridDocs);
const exactUnstable = queries.filter((_, k) => {
	const first = (exactRuns[0]?.[k] as PerQuery).hybridDocs;
	return exactRuns.some(
		(run) => !sameList((run[k] as PerQuery).hybridDocs, first),
	);
});

// 질의별로 재생성 평균 RR을 구해 ANN과 EXACT를 짝지어 비교 (질의 수가 적어 부트스트랩 신뢰구간으로 읽는다)
const perQueryMean = (all: PerQuery[][], pick: (r: PerQuery) => number) =>
	queries.map((_, k) => mean(all.map((run) => pick(run[k] as PerQuery))));
const diffVector = pairedBootstrap(
	perQueryMean(exactRuns, (r) => r.vectorRR),
	perQueryMean(annRuns, (r) => r.vectorRR),
);
const diffHybrid = pairedBootstrap(
	perQueryMean(exactRuns, (r) => r.hybridRR),
	perQueryMean(annRuns, (r) => r.hybridRR),
);

const lines: string[] = [];
lines.push(
	`# ANN 인덱스 재생성 실험 (${new Date().toISOString()})`,
	"",
	`- Vault: ${vaultPath}`,
	`- 벡터 행 ${rowCount}개, 질의 ${queries.length}개, 인덱스 재생성 ${REBUILDS}회`,
	"",
	"| 회차 | 벡터 MRR ANN | 벡터 MRR EXACT | 하이브리드 MRR ANN | 하이브리드 MRR EXACT | 청크 겹침 | 정확 검색과 다른 질의(벡터/하이브리드) |",
	"|---:|---:|---:|---:|---:|---:|---:|",
	...runs.map(
		(r) =>
			`| ${r.run} | ${r.ann.vectorMRR.toFixed(3)} | ${r.exact.vectorMRR.toFixed(3)} | ${r.ann.hybridMRR.toFixed(3)} | ${r.exact.hybridMRR.toFixed(3)} | ${r.chunkOverlap.toFixed(3)} | ${r.vectorDiffersFromExact} / ${r.hybridDiffersFromExact} |`,
	),
	"",
	`- 벡터 MRR@10 ANN: ${fmt(summary.vectorMRR.ann)}`,
	`- 벡터 MRR@10 EXACT: ${fmt(summary.vectorMRR.exact)}`,
	`- 하이브리드 MRR@10 ANN: ${fmt(summary.hybridMRR.ann)}`,
	`- 하이브리드 MRR@10 EXACT: ${fmt(summary.hybridMRR.exact)}`,
	`- 청크 겹침(정확 검색 상위 ${DENSE_USED}개 중 ANN에도 있는 비율): ${fmt(summary.chunkOverlap)}`,
	`- 재생성 사이에 결과가 바뀐 질의: 벡터 ${unstableVector.length}개, 하이브리드 ${unstableHybrid.length}개 (EXACT에서 바뀐 질의 ${exactUnstable.length}개, 0이어야 정상)`,
	`- ANN 평균 - EXACT 차이 (질의별 짝지은 부트스트랩 95% CI): 벡터 ${diffVector.meanDiff.toFixed(3)} [${diffVector.ciLow.toFixed(3)}, ${diffVector.ciHigh.toFixed(3)}], 하이브리드 ${diffHybrid.meanDiff.toFixed(3)} [${diffHybrid.ciLow.toFixed(3)}, ${diffHybrid.ciHigh.toFixed(3)}]`,
);
if (runs.some((r) => r.indexCount !== 1)) {
	lines.push(
		"",
		"> 경고: 재생성 후 인덱스가 1개가 아닌 회차가 있습니다. 인덱스가 교체되지 않고 쌓였다면 이 결과를 믿을 수 없습니다.",
	);
}
const report = lines.join("\n");
console.log(report);

await mkdir(args.out as string, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(join(args.out as string, `ann-variance-${stamp}.md`), report);
await writeFile(
	join(args.out as string, `ann-variance-${stamp}.json`),
	JSON.stringify(
		{
			vault: vaultPath,
			rowCount,
			queries: queries.length,
			runs,
			summary,
			unstableVector,
			unstableHybrid,
			exactUnstable,
			diffVector,
			diffHybrid,
		},
		null,
		2,
	),
);
console.error(`[ann-variance] 결과를 ${args.out}에 저장했습니다.`);
process.exit(0);
