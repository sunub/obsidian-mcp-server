/**
 * scripts/eval_retrieval.ts 결과의 원인 분리 진단. 평가 때 만든 Vault와 벡터 인덱스를 재사용한다.
 *
 *   npx tsx scripts/eval_retrieval.ts --sample 100 --out .eval-cache/full
 *   npx tsx scripts/eval_retrieval_diagnose.ts [.eval-cache/full]
 *
 * 1. 벡터 단독: IVF-PQ(서버 기본) / 정확 검색 / 정확 검색 + 질의 접두어 제거
 * 2. RRF 후보 중 키워드로만 찾은 문서 비율 (리랭커에 본문 대신 파일 경로가 들어가는 문서)
 * 3. RRF 이후 재판정만 켜고 리랭커 입력을 바꿔 비교: 그대로 / 파일명을 노트 제목으로 / 본문
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
const ROOT = process.cwd();
const runDir = join(ROOT, process.argv[2] ?? ".eval-cache/full");
const vaultDir = join(runDir, "vault");
process.env.VAULT_DIR_PATH = vaultDir;
const b = (p: string) => import(`${ROOT}/build/${p}`);
const { VaultManager } = await b("utils/VaultManger/VaultManager.js");
const { localEmbedder } = await b("utils/Embedder.js");
const { localReranker } = await b("utils/LocalReranker.js");
const { vectorDB } = await b("utils/VectorDB.js");
const { connect } = await import(
	`${ROOT}/node_modules/@lancedb/lancedb/dist/index.js`
);

const res = JSON.parse(readFileSync(join(runDir, "results.json"), "utf8"));
const rows: {
	question: string;
	goldId: string;
	ranks: Record<string, number>;
}[] = res.rows;
const title = new Map<string, string>();
const body = new Map<string, string>();
for (const f of readdirSync(vaultDir).filter((f) => f.endsWith(".md"))) {
	const raw = readFileSync(join(vaultDir, f), "utf8");
	const m = raw.match(/^---\ntitle: (.*)\n---\n\n([\s\S]*)$/);
	title.set(f.replace(/\.md$/, ""), m ? JSON.parse(m[1]) : "");
	body.set(f.replace(/\.md$/, ""), m ? m[2].trim() : raw);
}
const id = (p: string) => basename(p).replace(/\.md$/, "");
const isVaultPath = (s: string) => s.startsWith(vaultDir) && s.endsWith(".md");
const vm = new VaultManager(vaultDir, 20);
await vm.initialize();
await localEmbedder.init();
await localReranker.init();
const realRerank = localReranker.rerank.bind(localReranker);
const n = rows.length;
const pct = (x: number) => `${((100 * x) / n).toFixed(1)}%`;
const out: string[] = [];

// ---- D2: 벡터 검색 조건 ----
const db = await connect(join(vaultDir, ".obsidian", "vector_cache"));
const table = await db.openTable("obsidian_chunks");
const vecHit = { ivf: 0, exact: 0, exactNoPrefix: 0 };
type Hit = { filePath: string };
type Fused = { document: { filePath: string }; matchedChunks: unknown[] };
const top10 = (hits: Hit[]) =>
	[...new Set(hits.map((h) => id(h.filePath)))].slice(0, 10);
for (const r of rows) {
	const v = await localEmbedder.embed(`search_query: ${r.question}`);
	const v2 = await localEmbedder.embed(r.question);
	if (top10(await vectorDB.search(v, 90)).includes(r.goldId)) vecHit.ivf++;
	if (
		top10(
			await table
				.vectorSearch(v)
				.distanceType("cosine")
				.bypassVectorIndex()
				.limit(90)
				.toArray(),
		).includes(r.goldId)
	)
		vecHit.exact++;
	if (
		top10(
			await table
				.vectorSearch(v2)
				.distanceType("cosine")
				.bypassVectorIndex()
				.limit(90)
				.toArray(),
		).includes(r.goldId)
	)
		vecHit.exactNoPrefix++;
}
out.push(
	`벡터 단독 Hit@10 — IVF-PQ(서버 기본): ${pct(vecHit.ivf)}, 정확 검색: ${pct(vecHit.exact)}, 정확 검색+질의 접두어 제거: ${pct(vecHit.exactNoPrefix)}`,
);

// ---- D1: RRF 후보 구성 ----
const passthrough = async (_q: string, docs: string[]) =>
	docs.map((d, i) => ({ document: d, score: 1 - i / (docs.length + 1) }));
localReranker.rerank = passthrough;
let goldInFused = 0,
	goldKeywordOnly = 0,
	fusedKwOnly = 0,
	fusedTotal = 0;
for (const r of rows) {
	// hybridSearch는 상위 limit개만 돌려주므로 후보 20개를 보려고 limit=20으로 부른다(벡터 recall 조건은 평가 때와 다름).
	const wide = (await vm.hybridSearch(r.question, 20)).results;
	for (const x of wide) {
		fusedTotal++;
		if (x.matchedChunks.length === 0) fusedKwOnly++;
	}
	const g = wide.find((x: Fused) => id(x.document.filePath) === r.goldId);
	if (g) {
		goldInFused++;
		if (g.matchedChunks.length === 0) goldKeywordOnly++;
	}
}
out.push(
	`RRF 후보(최대 20개) 중 키워드로만 찾은 문서 비율: ${((100 * fusedKwOnly) / fusedTotal).toFixed(1)}% — 이 문서들은 리랭커에 본문 대신 파일 경로가 들어감`,
);
out.push(
	`정답이 후보에 있는 질의: ${goldInFused}/${n}, 그중 정답이 키워드로만 찾아진 경우: ${goldKeywordOnly}`,
);

// ---- D3: RRF 이후 재판정만 켜고 입력 조건을 바꿔 비교 (벡터 내부 재판정은 끔) ----
async function runVariant(mode: "asis" | "title" | "content") {
	localReranker.rerank = async (q: string, docs: string[]) => {
		if ((new Error().stack ?? "").includes("safeSemanticSearch"))
			return passthrough(q, docs);
		const inputs = docs.map((d) =>
			!isVaultPath(d)
				? d
				: mode === "title"
					? join(dirname(d), `${title.get(id(d))}.md`)
					: mode === "content"
						? (body.get(id(d)) ?? d).slice(0, 1500)
						: d,
		);
		const scored = await realRerank(q, inputs);
		const used = new Set<number>();
		return scored.map((s: { document: string; score: number }) => {
			const i = inputs.findIndex((x, k) => x === s.document && !used.has(k));
			used.add(i);
			return { document: docs[i], score: s.score };
		});
	};
	let h1 = 0,
		h10 = 0,
		mrr = 0,
		fixed = 0,
		broken = 0;
	const t0 = performance.now();
	for (const r of rows) {
		const { results } = await vm.hybridSearch(r.question, 10);
		const ranked = [
			...new Set(results.map((x: Fused) => id(x.document.filePath))),
		].slice(0, 10);
		const k = ranked.indexOf(r.goldId);
		const before = r.ranks.hybrid_rrf;
		if (k === 0) h1++;
		if (k >= 0) {
			h10++;
			mrr += 1 / (k + 1);
		}
		if (before !== 0 && k === 0) fixed++;
		if (before === 0 && k !== 0) broken++;
	}
	out.push(
		`재판정 입력=${mode}: Hit@1 ${pct(h1)}, Hit@10 ${pct(h10)}, MRR ${(mrr / n).toFixed(3)}, 바로잡음 ${fixed} / 오판 ${broken}, ${((performance.now() - t0) / 1000).toFixed(0)}s`,
	);
	console.log(out.at(-1));
}
console.log(out.join("\n"));
for (const m of ["asis", "title", "content"] as const) await runVariant(m);
console.log(`\n=== 요약 ===\n${out.join("\n")}`);
process.exit(0);
