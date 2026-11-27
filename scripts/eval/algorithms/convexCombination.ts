import type {
	AlgorithmContext,
	DenseCandidate,
	KeywordCandidate,
	SearchAlgorithm,
} from "./types.js";

export interface ConvexCombinationOptions {
	name: string;
	alpha: number;
	minBm25Score?: number;
}

export function extractDenseScores(
	hits: DenseCandidate[],
): Map<string, number> {
	const scores = new Map<string, number>();
	for (const hit of hits) {
		const prev = scores.get(hit.relPath);
		if (prev === undefined || hit.similarity > prev) {
			scores.set(hit.relPath, hit.similarity);
		}
	}
	return scores;
}

export function extractBm25Scores(
	hits: KeywordCandidate[],
	minBm25Score: number,
): Map<string, number> {
	const scores = new Map<string, number>();
	for (const hit of hits) {
		if (hit.score >= minBm25Score) {
			scores.set(hit.relPath, hit.score);
		}
	}
	return scores;
}

export function normalizeScores(
	scores: Map<string, number>,
): Map<string, number> {
	if (scores.size === 0) {
		return new Map();
	}

	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const value of scores.values()) {
		if (value < min) {
			min = value;
		}
		if (value > max) {
			max = value;
		}
	}

	const range = max - min;
	const normalized = new Map<string, number>();
	for (const [key, value] of scores) {
		normalized.set(key, range === 0 ? 1 : (value - min) / range);
	}
	return normalized;
}

export function fuseNormalizedScores(
	denseNorm: Map<string, number>,
	bm25Norm: Map<string, number>,
	alpha: number,
): Map<string, number> {
	const allPaths = new Set([...denseNorm.keys(), ...bm25Norm.keys()]);
	const fused = new Map<string, number>();

	for (const relPath of allPaths) {
		const dense = denseNorm.get(relPath) ?? 0;
		const bm25 = bm25Norm.get(relPath) ?? 0;
		fused.set(relPath, alpha * dense + (1 - alpha) * bm25);
	}

	return fused;
}

export function createConvexCombination(
	options: ConvexCombinationOptions,
): SearchAlgorithm {
	const minBm25Score = options.minBm25Score ?? 0;

	return {
		name: options.name,
		description: `CC (alpha=${options.alpha}, minBm25=${minBm25Score})`,
		run(ctx: AlgorithmContext): string[] {
			const denseRaw = extractDenseScores(
				ctx.denseHits.slice(0, ctx.limit * 3),
			);
			const bm25Raw = extractBm25Scores(ctx.keywordHits, minBm25Score);
			const denseNorm = normalizeScores(denseRaw);
			const bm25Norm = normalizeScores(bm25Raw);
			const fused = fuseNormalizedScores(denseNorm, bm25Norm, options.alpha);

			return [...fused.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, ctx.limit)
				.map(([relPath]) => relPath);
		},
	};
}
