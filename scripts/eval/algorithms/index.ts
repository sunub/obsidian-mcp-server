import {
	baselineRrfAlgorithm,
	denseOnlyAlgorithm,
	keywordOnlyAlgorithm,
} from "./baseline.js";
import {
	createBm25fBigramHybrid,
	createBm25fBigramOnly,
} from "./bm25fBigram.js";
import { createConvexCombination } from "./convexCombination.js";
import {
	createAdaptiveRrfCc,
	createCcMaxWithPpr,
	createCcWithRelativeFloor,
	createRrfCcBlend,
} from "./hybridWinners.js";
import { createOneHopLinkBoost, createPprLinkBoost } from "./linkGraphBoost.js";
import type { SearchAlgorithm } from "./types.js";

export const algorithms: SearchAlgorithm[] = [
	baselineRrfAlgorithm,
	keywordOnlyAlgorithm,
	denseOnlyAlgorithm,
	createConvexCombination({ name: "cc_a0.5", alpha: 0.5 }),
	createConvexCombination({ name: "cc_a0.7", alpha: 0.7 }),
	createConvexCombination({
		name: "cc_a0.7_bm3",
		alpha: 0.7,
		minBm25Score: 3,
	}),
	createConvexCombination({
		name: "cc_a0.8_bm3",
		alpha: 0.8,
		minBm25Score: 3,
	}),
	createOneHopLinkBoost({
		name: "link_1hop",
		seedCount: 5,
		outWeight: 0.15,
		inWeight: 0.1,
	}),
	createPprLinkBoost({
		name: "link_ppr",
		seedCount: 10,
		damping: 0.3,
		blendWeight: 0.15,
	}),
	createBm25fBigramOnly({ name: "bm25f_bg_only", includeBigrams: true }),
	createBm25fBigramHybrid({ name: "bm25f_only_rrf", includeBigrams: false }),
	createBm25fBigramHybrid({ name: "bm25f_bg_rrf", includeBigrams: true }),
	createCcWithRelativeFloor({
		name: "cc_a0.5_rel70",
		alpha: 0.5,
		minRelativeScore: 0.7,
		bm25NormMode: "minmax",
	}),
	createCcWithRelativeFloor({
		name: "cc_a0.5_rel70_max",
		alpha: 0.5,
		minRelativeScore: 0.7,
		bm25NormMode: "max",
	}),
	createAdaptiveRrfCc({
		name: "adaptive_rrf_cc",
		longQueryTokens: 4,
		alpha: 0.5,
		minRelativeScore: 0,
		bm25NormMode: "max",
	}),
	createRrfCcBlend({
		name: "rrf_cc_blend",
		ccWeight: 0.5,
		alpha: 0.5,
		minRelativeScore: 0.7,
		bm25NormMode: "max",
	}),
	createCcMaxWithPpr({
		name: "cc_rel70_max_ppr",
		alpha: 0.5,
		minRelativeScore: 0.7,
		pprWeight: 0.1,
	}),
];
