import { describe, expect, it } from "vitest";
import {
	baselineRrfAlgorithm,
	denseOnlyAlgorithm,
	keywordOnlyAlgorithm,
} from "../../scripts/eval/algorithms/baseline.js";
import {
	Bm25fBigramIndex,
	createBm25fBigramOnly,
} from "../../scripts/eval/algorithms/bm25fBigram.js";
import {
	createConvexCombination,
	extractBm25Scores,
	extractDenseScores,
	normalizeScores,
} from "../../scripts/eval/algorithms/convexCombination.js";
import {
	applyOneHopLinkBoost,
	computePersonalizedPageRank,
	createOneHopLinkBoost,
	createPprLinkBoost,
} from "../../scripts/eval/algorithms/linkGraphBoost.js";
import type {
	AlgorithmContext,
	EvalDataset,
	SearchAlgorithm,
} from "../../scripts/eval/algorithms/types.js";
import {
	buildLinkGraph,
	resolveRelevant,
	scoreAlgorithm,
} from "../../scripts/eval/compare-algorithms.js";

function makeContext(
	overrides: Partial<AlgorithmContext> = {},
): AlgorithmContext {
	return {
		query: "test query",
		limit: 5,
		keywordHits: [
			{ relPath: "a.md", score: 10 },
			{ relPath: "b.md", score: 7.5 },
			{ relPath: "noise.md", score: 4 },
		],
		denseHits: [
			{
				relPath: "b.md",
				distance: 0.1,
				similarity: 0.9,
				chunkContent: "chunk b1",
			},
			{
				relPath: "b.md",
				distance: 0.15,
				similarity: 0.85,
				chunkContent: "chunk b2",
			},
			{
				relPath: "c.md",
				distance: 0.2,
				similarity: 0.8,
				chunkContent: "chunk c",
			},
		],
		graph: { outLinks: new Map(), inLinks: new Map() },
		documents: [],
		vaultPath: "/tmp/vault",
		embed: async () => [],
		searchVector: async () => [],
		searchKeyword: () => [],
		...overrides,
	};
}

describe("AlgorithmEvalHarness", () => {
	it("applies 70% keyword floor and deduplicates dense hits in baseline RRF", () => {
		const ranked = baselineRrfAlgorithm.run(makeContext());

		expect(ranked).toEqual(["b.md", "a.md", "c.md"]);
	});

	it("disables 70% keyword floor when dense results are empty", () => {
		const ranked = baselineRrfAlgorithm.run(makeContext({ denseHits: [] }));

		expect(ranked).toEqual(["a.md", "b.md", "noise.md"]);
	});

	it("returns keyword-only and dense-only reference rankings", () => {
		const ctx = makeContext();

		expect(keywordOnlyAlgorithm.run(ctx)).toEqual(["a.md", "b.md", "noise.md"]);
		expect(denseOnlyAlgorithm.run(ctx)).toEqual(["b.md", "c.md"]);
	});

	it("builds bidirectional wiki-link graph by relative path and basename", () => {
		const graph = buildLinkGraph([
			{ relPath: "notes/http.md", documentLinks: ["tcp", "notes/http"] },
			{ relPath: "cs/tcp.md", documentLinks: ["notes/http"] },
		]);

		expect(graph.outLinks.get("notes/http.md")).toEqual(["cs/tcp.md"]);
		expect(graph.inLinks.get("cs/tcp.md")).toEqual(["notes/http.md"]);
		expect(graph.outLinks.get("cs/tcp.md")).toEqual(["notes/http.md"]);
		expect(graph.inLinks.get("notes/http.md")).toEqual(["cs/tcp.md"]);
	});

	it("scores algorithms and skips queries with empty relevant lists", async () => {
		const dataset: EvalDataset = {
			name: "sample",
			useLenient: false,
			queries: [
				{ id: "q1", type: "keyword", query: "q1", relevant: ["a.md"] },
				{ id: "q2", type: "semantic", query: "q2", relevant: ["b.md"] },
				{ id: "q3", type: "semantic", query: "q3", relevant: [] },
			],
		};

		const perfectSemantic: SearchAlgorithm = {
			name: "mock",
			description: "mock",
			run: (ctx) => (ctx.query === "q1" ? ["b.md", "a.md"] : ["b.md"]),
		};

		const summary = await scoreAlgorithm(perfectSemantic, dataset, async (q) =>
			makeContext({ query: q.query }),
		);

		expect(summary.count).toBe(2);
		expect(summary.mrr10).toBeCloseTo(0.75);
		expect(summary.semanticMrr10).toBeCloseTo(1.0);
		expect(summary.recall5).toBeCloseTo(1.0);
	});

	it("selects lenient labels only when requested and available", () => {
		const q = {
			id: "q1",
			type: "semantic",
			query: "x",
			relevant: ["a.md"],
			relevant_lenient: ["a.md", "b.md"],
		};

		expect(resolveRelevant(q, false)).toEqual(["a.md"]);
		expect(resolveRelevant(q, true)).toEqual(["a.md", "b.md"]);
	});
});

describe("ConvexCombination", () => {
	it("normalizes empty, single-entry, and multi-entry maps safely", () => {
		expect(normalizeScores(new Map()).size).toBe(0);
		expect(normalizeScores(new Map([["a.md", 5]])).get("a.md")).toBe(1);

		const norm = normalizeScores(
			new Map([
				["a.md", 10],
				["b.md", 6],
				["c.md", 2],
			]),
		);
		expect(norm.get("a.md")).toBeCloseTo(1);
		expect(norm.get("b.md")).toBeCloseTo(0.5);
		expect(norm.get("c.md")).toBeCloseTo(0);
	});

	it("keeps max dense similarity per file and filters BM25 by absolute floor", () => {
		const ctx = makeContext();
		const dense = extractDenseScores(ctx.denseHits);
		const bm25 = extractBm25Scores(ctx.keywordHits, 5);

		expect(dense.get("b.md")).toBeCloseTo(0.9);
		expect([...bm25.keys()]).toEqual(["a.md", "b.md"]);
	});

	it("elevates strong dense hit when weak keyword hits are filtered out", () => {
		const cc = createConvexCombination({
			name: "cc_test",
			alpha: 0.7,
			minBm25Score: 5,
		});
		const ranked = cc.run(
			makeContext({
				keywordHits: [{ relPath: "noise.md", score: 2.1 }],
				denseHits: [
					{
						relPath: "semantic.md",
						distance: 0.12,
						similarity: 0.88,
						chunkContent: "best semantic",
					},
					{
						relPath: "other.md",
						distance: 0.25,
						similarity: 0.75,
						chunkContent: "second semantic",
					},
				],
			}),
		);

		expect(ranked[0]).toBe("semantic.md");
		expect(ranked).not.toContain("noise.md");
	});
});

describe("LinkGraphBoost", () => {
	it("boosts wiki-linked neighbors in 1-hop and PPR modes", () => {
		const graph = buildLinkGraph([
			{ relPath: "seed.md", documentLinks: ["linked.md"] },
			{ relPath: "linked.md", documentLinks: [] },
			{ relPath: "unlinked.md", documentLinks: [] },
		]);

		const base = new Map([["seed.md", 0.03]]);
		const oneHop = applyOneHopLinkBoost(base, graph, {
			seedCount: 1,
			outWeight: 0.2,
			inWeight: 0.1,
		});
		expect(oneHop.get("linked.md")).toBeGreaterThan(0);

		const ppr = computePersonalizedPageRank(base, graph, {
			seedCount: 1,
			damping: 0.3,
			iterations: 10,
		});
		expect(ppr.get("linked.md")).toBeGreaterThan(0);

		const ctx = makeContext({
			keywordHits: [{ relPath: "seed.md", score: 10 }],
			denseHits: [
				{
					relPath: "seed.md",
					distance: 0.1,
					similarity: 0.9,
					chunkContent: "seed",
				},
			],
			graph,
		});
		expect(createOneHopLinkBoost({ name: "hop" }).run(ctx)).toEqual([
			"seed.md",
			"linked.md",
		]);
		expect(createPprLinkBoost({ name: "ppr" }).run(ctx)).toEqual([
			"seed.md",
			"linked.md",
		]);
	});
});

describe("Bm25fBigram", () => {
	it("matches Korean compound nouns via bigrams and ranks title matches higher", () => {
		const docs = [
			{
				relPath: "notes/body-mention.md",
				title: "기타 메모",
				tags: [],
				body: "프론트엔드에서 상태 관리 전략은 중요합니다.",
			},
			{
				relPath: "notes/state-guide.md",
				title: "React 상태 관리",
				tags: ["react"],
				body: "상태를 구조화하는 원칙",
			},
			{
				relPath: "notes/unrelated.md",
				title: "데이터베이스 인덱스",
				tags: ["db"],
				body: "B-Tree 구조 설명",
			},
		];

		const index = new Bm25fBigramIndex(docs, true);
		const hits = index.search("상태관리");

		expect(hits[0]?.relPath).toBe("notes/state-guide.md");
		expect(hits.map((h) => h.relPath)).toContain("notes/body-mention.md");
	});

	it("normalizes NFD Korean filenames so NFC queries match", () => {
		const nfdName = "회의록".normalize("NFD");
		const alg = createBm25fBigramOnly({ name: "bm25f_test" });
		const ranked = alg.run(
			makeContext({
				query: "회의록",
				documents: [
					{
						relPath: `docs/${nfdName}-2026.md`,
						title: "",
						tags: [],
						body: "안건 정리",
					},
				],
			}),
		);

		expect(ranked).toEqual([`docs/${nfdName}-2026.md`]);
	});
});
