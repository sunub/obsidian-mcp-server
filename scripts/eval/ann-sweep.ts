/**
 * ANN 검색 폭(nprobes, refineFactor) 스윕: 인덱스를 다시 만들어도 결과가 안정되는 설정 찾기.
 * (ann-variance.ts 의 후속. docs/search-quality-evaluation.md 4.7, 4.8)
 *
 * 인덱스를 R번 재생성하고, 매번 모든 (nprobes, refineFactor) 조합으로 같은 질의를 검색한다.
 * 조합마다 정확 검색(bypassVectorIndex) 대비 청크 겹침, MRR의 재생성 간 편차, 질의 지연을 구한다.
 *   목표: 청크 겹침 ~1.0, 재생성 간 MRR 표준편차 ~0 을 만족하는 가장 싼 조합.
 *
 * 사용법 (빌드 결과물 사용, 벡터가 이미 색인돼 있어야 함):
 *   npx tsx scripts/eval/ann-sweep.ts --vault <복사본 Vault> --allow-reset [--rebuilds 5]
 *     [--nprobes 20,40,71] [--refine 1,5,10]
 *
 * 주의: 벡터 인덱스를 교체한다(벡터 행은 지우지 않는다). 복사본 Vault에서만 실행한다.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { mean, percentile, reciprocalRankAtK } from "./lib/metrics.js";

const { values: args } = parseArgs({
	options: {
		vault: { type: "string" },
		queries: { type: "string", default: "eval/search/queries.jsonl" },
		rebuilds: { type: "string", default: "5" },
		nprobes: { type: "string", default: "20,40,71" },
		refine: { type: "string", default: "1,5,10" },
		reps: { type: "string", default: "3" },
		out: { type: "string", default: "eval/search/results/ann-sweep" },
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
const REPS = Number(args.reps);
const NPROBES = (args.nprobes as string).split(",").map(Number);
const REFINES = (args.refine as string).split(",").map(Number);
if (!Number.isInteger(REBUILDS) || REBUILDS < 2) {
	console.error("--rebuilds 는 2 이상의 정수여야 합니다.");
	process.exit(1);
}
const LIMIT = 10;
const RRF_K = 60;
const DENSE_RECALL = LIMIT * 9;
const DENSE_USED = LIMIT * 3;

const { Indexer } = await import("../../build/shared/indexing/Indexer.js");
const { DirectoryWalker } = await import(
	"../../build/shared/indexing/DirectoryWalker.js"
);
const { Semaphore } = await import("../../build/shared/async/semaphore.js");
const { localEmbedder } = await import(
	"../../build/shared/local-ai/Embedder.js"
);
const { vectorDB } = await import("../../build/shared/indexing/VectorDB.js");

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
	console.error("벡터 테이블이 없습니다. 먼저 색인하세요.");
	process.exit(1);
}
// createVectorIndex는 자기 핸들로 커밋하므로, 재생성 후에는 테이블을 새로 열어야 새 인덱스가 보인다
let table = maybeTable;
const rowCount = await table.countRows();
if (rowCount < 256) {
	console.error(`벡터 행이 ${rowCount}개라 인덱스가 만들어지지 않습니다.`);
	process.exit(1);
}

console.error(`[ann-sweep] 질의 ${queries.length}개 임베딩 중...`);
const queryVectors = new Map<string, number[]>();
for (const q of queries) {
	queryVectors.set(q.id, await localEmbedder.embed(q.query));
}

type Mode = { exact: true } | { exact: false; nprobes: number; refine: number };

async function dense(queryId: string, mode: Mode): Promise<Chunk[]> {
	const vector = queryVectors.get(queryId) as number[];
	let query = table.vectorSearch(vector).distanceType("cosine");
	query = mode.exact
		? query.bypassVectorIndex()
		: query.nprobes(mode.nprobes).refineFactor(mode.refine);
	return (await query.limit(DENSE_RECALL).toArray()) as Chunk[];
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

type Score = {
	vectorMRR: number;
	hybridMRR: number;
	chunkOverlap: number;
	latencyMs: number[];
	topIds: string[][];
};

/** 한 모드로 모든 질의를 검색해 품질, 겹침(정확 검색 대비), 지연을 구한다 */
async function run(mode: Mode, exactIds: string[][] | null): Promise<Score> {
	const vectorRR: number[] = [];
	const hybridRR: number[] = [];
	const overlap: number[] = [];
	const latencyMs: number[] = [];
	const topIds: string[][] = [];
	for (const [k, q] of queries.entries()) {
		let chunks: Chunk[] = [];
		for (let r = 0; r < REPS; r++) {
			const t0 = performance.now();
			chunks = await dense(q.id, mode);
			latencyMs.push(performance.now() - t0);
		}
		const used = chunks.slice(0, DENSE_USED);
		const ids = used.map((c) => String(c.id));
		topIds.push(ids);
		vectorRR.push(
			reciprocalRankAtK(uniqueDocs(chunks).slice(0, LIMIT), q.relevant, LIMIT),
		);
		hybridRR.push(
			reciprocalRankAtK(
				fuse(indexer.search(q.query) as Doc[], used),
				q.relevant,
				LIMIT,
			),
		);
		if (exactIds) {
			const truth = new Set(exactIds[k]);
			overlap.push(
				truth.size === 0
					? 1
					: ids.filter((id) => truth.has(id)).length / truth.size,
			);
		}
	}
	return {
		vectorMRR: mean(vectorRR),
		hybridMRR: mean(hybridRR),
		chunkOverlap: overlap.length ? mean(overlap) : 1,
		latencyMs,
		topIds,
	};
}

// 정확 검색 기준선 (인덱스와 무관하므로 한 번만 계산)
const exactScore = await run({ exact: true }, null);
const exactIds = exactScore.topIds;
console.error(
	`[ann-sweep] EXACT 벡터 MRR ${exactScore.vectorMRR.toFixed(3)}, 하이브리드 MRR ${exactScore.hybridMRR.toFixed(3)}, 지연 p50 ${percentile(exactScore.latencyMs, 50).toFixed(2)}ms`,
);

const combos = NPROBES.flatMap((n) => REFINES.map((r) => ({ n, r })));
const results = new Map<string, Score[]>();
for (const { n, r } of combos) results.set(`${n}/${r}`, []);

for (let i = 1; i <= REBUILDS; i++) {
	await vectorDB.createVectorIndex();
	table = (await vectorDB.getTable()) ?? table;
	for (const { n, r } of combos) {
		const score = await run({ exact: false, nprobes: n, refine: r }, exactIds);
		results.get(`${n}/${r}`)?.push(score);
	}
	console.error(`[ann-sweep] 재생성 ${i}/${REBUILDS} 완료`);
}

const sd = (v: number[]) => {
	const m = mean(v);
	return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
};
const rows = combos.map(({ n, r }) => {
	const scores = results.get(`${n}/${r}`) as Score[];
	const lat = scores.flatMap((s) => s.latencyMs);
	return {
		nprobes: n,
		refine: r,
		overlapMean: mean(scores.map((s) => s.chunkOverlap)),
		overlapMin: Math.min(...scores.map((s) => s.chunkOverlap)),
		vectorMRRMean: mean(scores.map((s) => s.vectorMRR)),
		vectorMRRSd: sd(scores.map((s) => s.vectorMRR)),
		hybridMRRMean: mean(scores.map((s) => s.hybridMRR)),
		hybridMRRSd: sd(scores.map((s) => s.hybridMRR)),
		hybridMRRMin: Math.min(...scores.map((s) => s.hybridMRR)),
		hybridMRRMax: Math.max(...scores.map((s) => s.hybridMRR)),
		latP50: percentile(lat, 50),
		latP95: percentile(lat, 95),
	};
});

const f = (v: number, d = 3) => v.toFixed(d);
const lines = [
	`# ANN 검색 폭 스윕 (${new Date().toISOString()})`,
	"",
	`- Vault: ${vaultPath}`,
	`- 벡터 행 ${rowCount}개, 질의 ${queries.length}개, 인덱스 재생성 ${REBUILDS}회, 질의당 ${REPS}회 반복 측정`,
	`- 기준(EXACT): 벡터 MRR ${f(exactScore.vectorMRR)}, 하이브리드 MRR ${f(exactScore.hybridMRR)}, 지연 p50 ${f(percentile(exactScore.latencyMs, 50), 2)}ms / p95 ${f(percentile(exactScore.latencyMs, 95), 2)}ms`,
	"",
	"| nprobes | refine | 청크 겹침 평균 (최소) | 벡터 MRR 평균 ± sd | 하이브리드 MRR 평균 ± sd (범위) | 지연 p50 / p95 ms |",
	"|---:|---:|---:|---:|---:|---:|",
	...rows.map(
		(x) =>
			`| ${x.nprobes} | ${x.refine} | ${f(x.overlapMean)} (${f(x.overlapMin)}) | ${f(x.vectorMRRMean)} ± ${f(x.vectorMRRSd)} | ${f(x.hybridMRRMean)} ± ${f(x.hybridMRRSd)} (${f(x.hybridMRRMin)}~${f(x.hybridMRRMax)}) | ${f(x.latP50, 2)} / ${f(x.latP95, 2)} |`,
	),
];
const report = lines.join("\n");
console.log(report);
await mkdir(args.out as string, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(join(args.out as string, `ann-sweep-${stamp}.md`), report);
await writeFile(
	join(args.out as string, `ann-sweep-${stamp}.json`),
	JSON.stringify(
		{
			vault: vaultPath,
			rowCount,
			exact: {
				vectorMRR: exactScore.vectorMRR,
				hybridMRR: exactScore.hybridMRR,
			},
			rows,
		},
		null,
		2,
	),
);
process.exit(0);
