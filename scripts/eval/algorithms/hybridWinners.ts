import { computeBaselineRrfScores, filterByRelativeFloor } from "./baseline.js";
import {
	extractBm25Scores,
	extractDenseScores,
	fuseNormalizedScores,
	normalizeScores,
} from "./convexCombination.js";
import { computePersonalizedPageRank } from "./linkGraphBoost.js";
import type { AlgorithmContext, SearchAlgorithm } from "./types.js";

const TOKEN_SPLIT = /\s+/;

export function maxNormalizeScores(
	scores: Map<string, number>,
): Map<string, number> {
	if (scores.size === 0) return new Map();
	let max = 0;
	for (const value of scores.values()) {
		if (value > max) max = value;
	}
	if (max <= 0) return new Map();
	const normalized = new Map<string, number>();
	for (const [key, value] of scores) {
		normalized.set(key, value / max);
	}
	return normalized;
}

function computeCcWithFloorScores(
	ctx: AlgorithmContext,
	options: {
		alpha: number;
		minRelativeScore: number;
		bm25NormMode: "minmax" | "max";
	},
): Map<string, number> {
	const denseWindow = ctx.denseHits.slice(0, ctx.limit * 3);
	const denseRaw = extractDenseScores(denseWindow);
	const filteredKeyword = filterByRelativeFloor(
		ctx.keywordHits,
		denseWindow.length > 0 ? options.minRelativeScore : 0,
	);
	const bm25Raw = extractBm25Scores(filteredKeyword, 0);

	const denseNorm = normalizeScores(denseRaw);
	const bm25Norm =
		options.bm25NormMode === "max"
			? maxNormalizeScores(bm25Raw)
			: normalizeScores(bm25Raw);

	return fuseNormalizedScores(denseNorm, bm25Norm, options.alpha);
}

function rankTop(scores: Map<string, number>, limit: number): string[] {
	return [...scores.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([relPath]) => relPath);
}

export function createCcWithRelativeFloor(options: {
	name: string;
	alpha: number;
	minRelativeScore: number;
	bm25NormMode: "minmax" | "max";
}): SearchAlgorithm {
	return {
		name: options.name,
		description: `CC (a=${options.alpha}, rel=${options.minRelativeScore}, bm25=${options.bm25NormMode})`,
		run(ctx: AlgorithmContext): string[] {
			return rankTop(computeCcWithFloorScores(ctx, options), ctx.limit);
		},
	};
}

export function createAdaptiveRrfCc(options: {
	name: string;
	longQueryTokens: number;
	alpha: number;
	minRelativeScore: number;
	bm25NormMode: "minmax" | "max";
}): SearchAlgorithm {
	return {
		name: options.name,
		description: `Adaptive (tokens>=${options.longQueryTokens} -> CC, else RRF)`,
		run(ctx: AlgorithmContext): string[] {
			const tokenCount = ctx.query
				.trim()
				.split(TOKEN_SPLIT)
				.filter((t) => t.length > 0).length;
			const scores =
				tokenCount >= options.longQueryTokens
					? computeCcWithFloorScores(ctx, {
							alpha: options.alpha,
							minRelativeScore: options.minRelativeScore,
							bm25NormMode: options.bm25NormMode,
						})
					: computeBaselineRrfScores(ctx);
			return rankTop(scores, ctx.limit);
		},
	};
}

export function createRrfCcBlend(options: {
	name: string;
	ccWeight: number;
	alpha: number;
	minRelativeScore: number;
	bm25NormMode: "minmax" | "max";
}): SearchAlgorithm {
	return {
		name: options.name,
		description: `Blend (rrf=${1 - options.ccWeight}, cc=${options.ccWeight})`,
		run(ctx: AlgorithmContext): string[] {
			const rrfNorm = normalizeScores(computeBaselineRrfScores(ctx));
			const ccNorm = normalizeScores(
				computeCcWithFloorScores(ctx, {
					alpha: options.alpha,
					minRelativeScore: options.minRelativeScore,
					bm25NormMode: options.bm25NormMode,
				}),
			);
			const blended = fuseNormalizedScores(ccNorm, rrfNorm, options.ccWeight);
			return rankTop(blended, ctx.limit);
		},
	};
}

export function createCcMaxWithPpr(options: {
	name: string;
	alpha: number;
	minRelativeScore: number;
	pprWeight: number;
}): SearchAlgorithm {
	return {
		name: options.name,
		description: `CC max-norm + PPR (ppr=${options.pprWeight})`,
		run(ctx: AlgorithmContext): string[] {
			const baseScores = computeCcWithFloorScores(ctx, {
				alpha: options.alpha,
				minRelativeScore: options.minRelativeScore,
				bm25NormMode: "max",
			});
			const pprScores = computePersonalizedPageRank(baseScores, ctx.graph, {
				seedCount: 10,
				damping: 0.3,
				iterations: 10,
			});
			const blended = fuseNormalizedScores(
				normalizeScores(pprScores),
				normalizeScores(baseScores),
				options.pprWeight,
			);
			return rankTop(blended, ctx.limit);
		},
	};
}
