/**
 * nprobes 자동 보정이 실제 질의에서도 맞는지 검증 (ann-sweep.ts 의 후속).
 *
 * 보정(calibration): 청크에서 만든 보정 질의 M개로 정확 검색 대비 겹침을 재고,
 *                    목표 겹침을 처음 넘는 가장 작은 nprobes 를 고른다.
 * 검증(validation):  같은 nprobes 를 평가셋 질의(사람이 쓴 짧은 질문)에 적용했을 때의 겹침을 잰다.
 *
 * 보정 질의를 만드는 방식(--sources):
 *   chunk    저장된 청크 벡터 그대로 (자기 자신은 제외). 기준선.
 *   heading  청크가 속한 섹션 제목 텍스트를 임베딩. 제목이 없는 청크는 표본에서 뺀다.
 *   tfidf    청크 본문의 TF-IDF 상위 단어(기본 4개)를 이어 붙인 텍스트를 임베딩.
 *   mixed    섹션 제목이 있으면 heading, 없으면 tfidf.
 *
 * 인덱스를 R번 재생성하고, 방식마다 시드 S개로 표본을 바꿔 가며 독립적으로 보정한다.
 *
 * 사용법 (빌드 결과물 사용, 벡터가 이미 색인돼 있어야 함):
 *   npx tsx scripts/eval/ann-calibration.ts --vault <복사본 Vault> --allow-reset
 *     [--rebuilds 3] [--seeds 5] [--samples 100] [--sources chunk,heading,tfidf,mixed]
 *
 * 주의: 벡터 인덱스를 교체한다(벡터 행은 지우지 않는다). 복사본 Vault에서만 실행한다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { mean, percentile, seededRandom } from "./lib/metrics.js";

const { values: args } = parseArgs({
	options: {
		vault: { type: "string" },
		queries: { type: "string", default: "eval/search/queries.jsonl" },
		rebuilds: { type: "string", default: "3" },
		seeds: { type: "string", default: "5" },
		samples: { type: "string", default: "100" },
		sources: { type: "string", default: "chunk,heading,tfidf,mixed" },
		terms: { type: "string", default: "4" },
		targets: { type: "string", default: "0.95,0.99,0.999" },
		grid: { type: "string", default: "10,15,20,25,30,35,40,45,50,55,60,65,71" },
		out: { type: "string", default: "eval/search/results/ann-calibration" },
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

type Source = "chunk" | "heading" | "tfidf" | "mixed";
const SOURCES = (args.sources as string).split(",") as Source[];
for (const s of SOURCES) {
	if (!["chunk", "heading", "tfidf", "mixed"].includes(s)) {
		console.error(`알 수 없는 --sources 값: ${s}`);
		process.exit(1);
	}
}
const REBUILDS = Number(args.rebuilds);
const SEED_COUNT = Number(args.seeds);
const SAMPLES = Number(args.samples);
const TERMS = Number(args.terms);
const TARGETS = (args.targets as string).split(",").map(Number);
const GRID = (args.grid as string).split(",").map(Number);
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => 7 + i);
if (!Number.isInteger(REBUILDS) || REBUILDS < 1) {
	console.error("--rebuilds 는 1 이상의 정수여야 합니다.");
	process.exit(1);
}
// 검색 경로(VaultManager.hybridSearch)와 같은 후보 수: 청크 90개를 받아 상위 30개를 쓴다
const RECALL_N = 90;
const USED_N = 30;
// 사전에 정한 판정 기준 (결과를 보기 전에 정함)
const MAX_SHORTFALL = 0.005; // 선택값에서 평가셋 겹침이 목표보다 이만큼까지만 낮아도 통과
const MAX_SPREAD = 10; // 선택된 nprobes 가 중앙값 ±5 안(범위 10 이내)에 있어야 함

const { localEmbedder } = await import(
	"../../build/shared/local-ai/Embedder.js"
);
const { vectorDB } = await import("../../build/shared/indexing/VectorDB.js");

type Row = {
	id: string;
	vector: ArrayLike<number>;
	content: string;
	context?: string;
	filePath: string;
};
type Hit = { id: string; _distance: number };

const evalSet: { id: string; query: string }[] = (
	await readFile(args.queries as string, "utf-8")
)
	.split("\n")
	.filter((line) => line.trim())
	.map((line) => JSON.parse(line));

let table = await vectorDB.getTable();
if (!table) {
	console.error("벡터 테이블이 없습니다. 먼저 색인하세요.");
	process.exit(1);
}
const rowCount = await table.countRows();
if (rowCount < 256) {
	console.error(`벡터 행이 ${rowCount}개라 인덱스가 만들어지지 않습니다.`);
	process.exit(1);
}
const rows = (await table
	.query()
	.select(["id", "vector", "content", "context", "filePath"])
	.limit(rowCount)
	.toArray()) as Row[];

// ---------- 보정 질의 생성 ----------

const tokenize = (text: string) =>
	text.toLowerCase().match(/[a-z0-9가-힣]+/g) ?? [];
const isTerm = (t: string) => t.length >= 2 && !/^\d+$/.test(t);

// IDF: 단어가 등장한 문서 수 (문서 = filePath)
const docTerms = new Map<string, Set<string>>();
for (const r of rows) {
	const set = docTerms.get(r.filePath) ?? new Set<string>();
	for (const t of tokenize(r.content)) if (isTerm(t)) set.add(t);
	docTerms.set(r.filePath, set);
}
const df = new Map<string, number>();
for (const set of docTerms.values()) {
	for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
}
const nDocs = docTerms.size;

function tfidfText(row: Row): string | null {
	const tf = new Map<string, number>();
	for (const t of tokenize(row.content)) {
		if (isTerm(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
	}
	const scored = [...tf.entries()]
		.map(([t, c]) => [t, c * Math.log(nDocs / (df.get(t) ?? 1))] as const)
		.sort((a, b) => b[1] - a[1])
		.slice(0, TERMS)
		.map(([t]) => t);
	return scored.length > 0 ? scored.join(" ") : null;
}

function headingText(row: Row): string | null {
	const m = /^Section: (.+)$/m.exec(row.context ?? "");
	return m?.[1]?.trim() || null;
}

/** 이 방식으로 질의를 만들 수 있는 청크의 텍스트(chunk 방식은 텍스트 없이 벡터를 쓴다) */
function textFor(source: Source, row: Row): string | null {
	if (source === "heading") return headingText(row);
	if (source === "tfidf") return tfidfText(row);
	if (source === "mixed") return headingText(row) ?? tfidfText(row);
	return null;
}

const embedCache = new Map<string, number[]>();
async function embedText(text: string): Promise<number[]> {
	const hit = embedCache.get(text);
	if (hit) return hit;
	const v = await localEmbedder.embed(text);
	embedCache.set(text, v);
	return v;
}

type Q = { vector: number[]; selfId: string | null; text: string | null };

function shuffled<T>(items: T[], seed: number): T[] {
	const random = seededRandom(seed);
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
}

async function buildQueries(source: Source, seed: number): Promise<Q[]> {
	const eligible =
		source === "chunk" ? rows : rows.filter((r) => textFor(source, r) !== null);
	const picked = shuffled(eligible, seed).slice(0, SAMPLES);
	const out: Q[] = [];
	for (const r of picked) {
		if (source === "chunk") {
			out.push({ vector: Array.from(r.vector), selfId: r.id, text: null });
		} else {
			const text = textFor(source, r) as string;
			out.push({ vector: await embedText(text), selfId: null, text });
		}
	}
	return out;
}

// ---------- 검색 ----------

async function search(
	q: Q,
	nprobes: number | null,
): Promise<{ ids: string[]; top1: number }> {
	if (!table) throw new Error("table");
	let query = table.vectorSearch(q.vector).distanceType("cosine");
	query =
		nprobes === null
			? query.bypassVectorIndex()
			: query.nprobes(nprobes).refineFactor(1);
	// 청크 벡터를 질의로 쓰면 자기 자신이 최근접 이웃이므로 한 개 더 받아 제외한다
	const hits = (await query.limit(RECALL_N + 1).toArray()) as Hit[];
	const filtered = hits.filter((h) => h.id !== q.selfId);
	return {
		ids: filtered.slice(0, USED_N).map((h) => h.id),
		top1: filtered[0]?._distance ?? Number.NaN,
	};
}

type Exact = { ids: Set<string>; top1: number };
async function exactFor(qs: Q[]): Promise<Exact[]> {
	const out: Exact[] = [];
	for (const q of qs) {
		const r = await search(q, null);
		out.push({ ids: new Set(r.ids), top1: r.top1 });
	}
	return out;
}

const overlapOf = (ids: string[], truth: Set<string>) =>
	truth.size === 0 ? 1 : ids.filter((id) => truth.has(id)).length / truth.size;

/** nprobes 후보마다 평균 겹침 (GRID 순서) */
async function curve(qs: Q[], exact: Exact[]): Promise<number[]> {
	const out: number[] = [];
	for (const n of GRID) {
		const values: number[] = [];
		for (const [k, q] of qs.entries()) {
			const r = await search(q, n);
			values.push(overlapOf(r.ids, (exact[k] as Exact).ids));
		}
		out.push(mean(values));
	}
	return out;
}

// ---------- 준비: 평가셋 질의와 방식×시드별 보정 질의, 정확 검색 ----------

console.error(`[ann-calibration] 청크 ${rowCount}개, 문서 ${nDocs}개`);
const evalQs: Q[] = [];
for (const q of evalSet) {
	evalQs.push({
		vector: await embedText(q.query),
		selfId: null,
		text: q.query,
	});
}
const evalExact = await exactFor(evalQs);

type Prepared = { source: Source; seed: number; qs: Q[]; exact: Exact[] };
const prepared: Prepared[] = [];
const eligibleCount: Record<string, number> = {};
for (const source of SOURCES) {
	eligibleCount[source] =
		source === "chunk"
			? rows.length
			: rows.filter((r) => textFor(source, r) !== null).length;
	for (const seed of SEEDS) {
		const qs = await buildQueries(source, seed);
		prepared.push({ source, seed, qs, exact: await exactFor(qs) });
	}
	const sample = prepared
		.filter((p) => p.source === source && p.seed === SEEDS[0])
		.flatMap((p) => p.qs.slice(0, 5).map((q) => q.text ?? "(청크 벡터)"));
	console.error(
		`[ann-calibration] ${source}: 가능한 청크 ${eligibleCount[source]}개, 예시 ${JSON.stringify(sample)}`,
	);
}

// ---------- 실험: 재생성마다 방식×시드로 보정하고 평가셋으로 검증 ----------

type Run = {
	build: number;
	source: Source;
	seed: number;
	chosen: Record<string, number | null>;
	evalAtChosen: Record<string, number | null>;
};
const runs: Run[] = [];
const evalCurves: number[][] = [];
const calibCurves = new Map<Source, number[][]>();

for (let b = 1; b <= REBUILDS; b++) {
	await vectorDB.createVectorIndex();
	// createVectorIndex 는 자기 핸들로 커밋하므로 새로 열어야 새 인덱스가 보인다
	table = (await vectorDB.getTable()) ?? table;
	const evalCurve = await curve(evalQs, evalExact);
	evalCurves.push(evalCurve);
	for (const p of prepared) {
		const c = await curve(p.qs, p.exact);
		const list = calibCurves.get(p.source) ?? [];
		list.push(c);
		calibCurves.set(p.source, list);
		const chosen: Record<string, number | null> = {};
		const evalAt: Record<string, number | null> = {};
		for (const t of TARGETS) {
			const idx = c.findIndex((v) => v >= t);
			chosen[String(t)] = idx === -1 ? null : (GRID[idx] as number);
			evalAt[String(t)] = idx === -1 ? null : (evalCurve[idx] as number);
		}
		runs.push({
			build: b,
			source: p.source,
			seed: p.seed,
			chosen,
			evalAtChosen: evalAt,
		});
	}
	console.error(`[ann-calibration] 재생성 ${b}/${REBUILDS} 완료`);
}

// ---------- 요약 ----------

const f = (v: number, d = 3) => v.toFixed(d);
const lines: string[] = [
	`# nprobes 보정 질의 방식 비교 (${new Date().toISOString()})`,
	"",
	`- Vault: ${vaultPath}`,
	`- 벡터 행 ${rowCount}개, 문서 ${nDocs}개, 평가셋 질의 ${evalSet.length}개, 방식당 표본 ${SAMPLES}개 × 시드 ${SEEDS.length}개, 인덱스 재생성 ${REBUILDS}회`,
	`- 판정 기준(사전 설정): 선택값에서 평가셋 겹침이 목표 −${MAX_SHORTFALL} 이내, 선택된 nprobes 범위 ${MAX_SPREAD} 이내`,
	"",
	"## 1. 질의 분포: 정확 검색 최근접 거리",
	"",
	"| 질의 방식 | 가능한 청크 | 최근접 거리 평균 | p10 | p50 | p90 |",
	"|---|---:|---:|---:|---:|---:|",
];
const dist = (v: number[]) =>
	`${f(mean(v))} | ${f(percentile(v, 10))} | ${f(percentile(v, 50))} | ${f(percentile(v, 90))}`;
lines.push(
	`| 평가셋(기준) | ${evalSet.length} | ${dist(evalExact.map((e) => e.top1))} |`,
);
for (const source of SOURCES) {
	const top1 = prepared
		.filter((p) => p.source === source)
		.flatMap((p) => p.exact.map((e) => e.top1));
	lines.push(`| ${source} | ${eligibleCount[source]} | ${dist(top1)} |`);
}

lines.push(
	"",
	"## 2. 곡선 차이: 평가셋 겹침 − 보정 질의 겹침 (재생성·시드 평균)",
	"",
	`| nprobes | ${SOURCES.join(" | ")} |`,
	`|---:|${SOURCES.map(() => "---:").join("|")}|`,
);
const meanEval = GRID.map((_, g) =>
	mean(evalCurves.map((c) => c[g] as number)),
);
for (const [g, n] of GRID.entries()) {
	const cells = SOURCES.map((s) => {
		const list = calibCurves.get(s) as number[][];
		const d = (meanEval[g] as number) - mean(list.map((c) => c[g] as number));
		return `${d >= 0 ? "+" : ""}${f(d)}`;
	});
	lines.push(`| ${n} | ${cells.join(" | ")} |`);
}

lines.push(
	"",
	"## 3. 보정 결과를 평가셋으로 검증",
	"",
	"| 질의 방식 | 목표 | 선택 nprobes 중앙값 (범위) | 평가셋 겹침 평균 / 최소 | 부족분 평균 | 목표−0.005 이상 비율 | 범위 기준 | 판정 |",
	"|---|---:|---|---:|---:|---:|---|---|",
);
const verdicts: Record<string, unknown>[] = [];
for (const source of SOURCES) {
	for (const t of TARGETS) {
		const rs = runs.filter((r) => r.source === source);
		const chosen = rs
			.map((r) => r.chosen[String(t)])
			.filter((v): v is number => v !== null && v !== undefined);
		const evalAt = rs
			.map((r) => r.evalAtChosen[String(t)])
			.filter((v): v is number => v !== null && v !== undefined);
		if (chosen.length === 0) {
			lines.push(`| ${source} | ${t} | 목표 미달 | - | - | - | - | - |`);
			continue;
		}
		const spread = Math.max(...chosen) - Math.min(...chosen);
		const okShare =
			evalAt.filter((v) => v >= t - MAX_SHORTFALL).length / evalAt.length;
		const pass = okShare === 1 && spread <= MAX_SPREAD;
		lines.push(
			`| ${source} | ${t} | ${percentile(chosen, 50)} (${Math.min(...chosen)}~${Math.max(...chosen)}) | ${f(mean(evalAt))} / ${f(Math.min(...evalAt))} | ${f(mean(evalAt.map((v) => v - t)))} | ${f(okShare, 2)} | ${spread <= MAX_SPREAD ? "통과" : `실패(${spread})`} | ${pass ? "**통과**" : "실패"} |`,
		);
		verdicts.push({ source, target: t, chosen, evalAt, spread, okShare, pass });
	}
}
const report = lines.join("\n");
console.log(report);

await mkdir(args.out as string, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(
	join(args.out as string, `ann-calibration-${stamp}.md`),
	report,
);
await writeFile(
	join(args.out as string, `ann-calibration-${stamp}.json`),
	JSON.stringify(
		{ vault: vaultPath, rowCount, grid: GRID, eligibleCount, runs, verdicts },
		null,
		2,
	),
);
process.exit(0);
