// 실행: node --test lab.test.mjs   (Node 18 이상, 설치할 것 없음)
// 각 테스트는 학습 문서의 개념 하나를 확인한다. 값을 바꿔 보며 실험해 보자.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	bm25Search,
	bm25Term,
	buildIndex,
	idfLucene,
	projectSearch,
} from "./bm25.mjs";
import {
	chunkContext,
	fixedChunks,
	headingChunks,
	recursiveChunks,
} from "./chunker.mjs";
import { buildIvf, exactTopK, ivfSearch } from "./ivf.mjs";
import {
	hitAt1,
	ndcgAtK,
	pairedBootstrap,
	recallAtK,
	reciprocalRank,
} from "./metrics.mjs";
import { rrf } from "./rrf.mjs";
import {
	queryTokenVariants,
	splitQuery,
	tokenizeDocument,
} from "./tokenize.mjs";

const docs = [
	{
		id: "a",
		text: "LanceDB 벡터 색인을 다시 만든다. LanceDB는 IVF-PQ를 쓴다.",
	},
	{ id: "b", text: "청킹 크기를 256 토큰으로 줄였다." },
	{
		id: "c",
		text: "Next.js 라우트와 LanceDB 연결 메모. 아주 긴 문서라서 다른 내용도 많다 많다 많다 많다.",
	},
];

test("토큰화: 본문은 문장부호에서 잘린다", () => {
	assert.deepEqual(tokenizeDocument("Next.js, tailwind-merge!"), [
		"next",
		"js",
		"tailwind",
		"merge",
	]);
	assert.deepEqual(splitQuery("  LanceDB,  다시 "), ["lancedb,", "다시"]);
});

test("토큰화 수정: 질의 토큰의 세 가지 형태", () => {
	assert.deepEqual(queryTokenVariants("(LanceDB)?"), {
		exact: "(lancedb)?",
		trimmed: "lancedb",
		parts: [],
	});
	assert.deepEqual(queryTokenVariants("next.js").parts, ["next", "js"]);
	assert.deepEqual(
		queryTokenVariants("I/O").parts,
		[],
		"한 글자 조각은 버린다",
	);
});

test("BM25: k1=0이면 tf를 무시한다 (이 프로젝트 방식과 같은 구조)", () => {
	const one = bm25Term(1, 10, 10, 1, 0, 0.75).tfPart;
	const many = bm25Term(9, 10, 10, 1, 0, 0.75).tfPart;
	assert.equal(one, 1);
	assert.equal(many, 1);
});

test("BM25: tf가 커져도 tfPart는 k1+1을 넘지 않는다 (포화)", () => {
	const k1 = 1.2;
	const big = bm25Term(1000, 10, 10, 1, k1, 0.75).tfPart;
	assert.ok(big < k1 + 1 && big > k1 + 1 - 0.01);
});

test("BM25: b=1이면 긴 문서의 점수가 깎인다, b=0이면 길이를 무시한다", () => {
	const shortDoc = bm25Term(2, 5, 10, 1, 1.2, 1).score;
	const longDoc = bm25Term(2, 20, 10, 1, 1.2, 1).score;
	assert.ok(shortDoc > longDoc);
	assert.equal(
		bm25Term(2, 5, 10, 1, 1.2, 0).score,
		bm25Term(2, 20, 10, 1, 1.2, 0).score,
	);
});

test("BM25 검색: 드문 단어(IDF 높음)를 가진 문서가 위로", () => {
	const idx = buildIndex(docs);
	assert.ok(idfLucene(3, 1) > idfLucene(3, 2));
	const r = bm25Search(idx, "lancedb 청킹");
	assert.deepEqual(new Set(r.map((x) => x.id)), new Set(["a", "b", "c"]));
	assert.equal(bm25Search(idx, "lancedb")[0].id, "a", "tf=2이고 짧은 a가 1위");
});

test("이 프로젝트 방식: 문장부호가 붙은 질의도 맞고, 중간 문장부호는 조각이 모두 있어야 한다", () => {
	const idx = buildIndex(docs);
	assert.deepEqual(
		projectSearch(idx, "LanceDB,")
			.map((x) => x.id)
			.sort(),
		["a", "c"],
	);
	assert.deepEqual(
		projectSearch(idx, "next.js").map((x) => x.id),
		["c"],
	);
});

test("RRF: 두 목록에서 모두 상위인 문서가 1위", () => {
	const r = rrf(
		[
			["x", "y", "z"],
			["y", "w", "x"],
		],
		60,
	);
	assert.equal(r[0].id, "y");
	assert.ok(Math.abs(r[0].score - (1 / 62 + 1 / 61)) < 1e-12);
});

test("RRF: k가 작을수록 1위의 영향이 커진다", () => {
	const lists = [
		["a", "b"],
		["b", "c"],
	];
	const gap = (k) => {
		const r = rrf(lists, k);
		return r[0].score - r[1].score;
	};
	assert.ok(gap(1) > gap(60));
});

test("청킹: 재귀 분할은 size를 넘지 않고, 문단 경계를 먼저 쓴다", () => {
	const text =
		"첫 문단입니다.\n\n둘째 문단은 조금 더 깁니다. 문장이 여러 개 있습니다.\n\n셋째.";
	const cs = recursiveChunks(text, { size: 30, overlap: 0 });
	for (const c of cs) assert.ok(c.text.length <= 30, c.text);
	assert.equal(cs[0].text, "첫 문단입니다.");
});

test("청킹: 고정 크기는 경계를 무시하고 overlap만큼 겹친다", () => {
	const cs = fixedChunks("abcdefghij", { size: 4, overlap: 1 });
	assert.deepEqual(
		cs.map((c) => c.text),
		["abcd", "defg", "ghij"],
	);
});

test("청킹: 제목 기준 분할과 섹션 문맥", () => {
	const md = "# 검색\n\n소개.\n\n## BM25\n\n점수 함수.\n\n## RRF\n\n순위 결합.";
	const cs = headingChunks(md, { size: 100, overlap: 0 });
	assert.equal(cs.length, 3);
	assert.equal(
		chunkContext(md, cs[1]),
		"Section: BM25\nOutline: 검색 > BM25 > RRF",
	);
});

test("지표: Recall@k, Hit@1, MRR, nDCG", () => {
	const ranked = ["x", "a", "y", "b"];
	const rel = new Set(["a", "b"]);
	assert.equal(recallAtK(ranked, rel, 2), 0.5);
	assert.equal(hitAt1(ranked, rel), 0);
	assert.equal(reciprocalRank(ranked, rel), 0.5);
	const perfect = ndcgAtK(
		["a", "b", "x"],
		new Map([
			["a", 1],
			["b", 1],
		]),
	);
	assert.equal(perfect, 1);
});

test("부트스트랩: 모든 질의에서 B가 0.1 높으면 구간도 0.1", () => {
	const a = [0.2, 0.5, 0.7, 0.1];
	const b = a.map((x) => x + 0.1);
	const r = pairedBootstrap(a, b, { iters: 2000 });
	assert.ok(Math.abs(r.lo - 0.1) < 1e-9 && Math.abs(r.hi - 0.1) < 1e-9);
});

test("IVF: nprobes = 전체 파티션이면 정확 검색과 같다", () => {
	const pts = Array.from({ length: 200 }, (_, i) => [
		Math.sin(i * 1.7) * 10,
		Math.cos(i * 2.3) * 10,
	]);
	const ivf = buildIvf(pts, 8, 3);
	const q = [1, 2];
	assert.deepEqual(ivfSearch(ivf, q, 10, 8).top, exactTopK(pts, q, 10));
	assert.ok(
		ivfSearch(ivf, q, 10, 1).scanned < 200,
		"nprobes=1이면 일부만 본다",
	);
});
