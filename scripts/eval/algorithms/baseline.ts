import type {
	AlgorithmContext,
	DenseCandidate,
	KeywordCandidate,
	SearchAlgorithm,
} from "./types.js";

const RRF_K = 60;
const KEYWORD_FUSION_MIN_RELATIVE_SCORE = 0.7;

export function filterByRelativeFloor(
	hits: KeywordCandidate[],
	minRelativeScore: number,
): KeywordCandidate[] {
	const topScore = hits[0]?.score ?? 0;
	if (topScore <= 0 || minRelativeScore <= 0) return hits;
	const floor = topScore * minRelativeScore;
	return hits.filter((hit) => hit.score >= floor);
}

export function uniqueDensePaths(hits: DenseCandidate[]): string[] {
	const seen = new Set<string>();
	const paths: string[] = [];
	for (const hit of hits) {
		if (!seen.has(hit.relPath)) {
			seen.add(hit.relPath);
			paths.push(hit.relPath);
		}
	}
	return paths;
}

export function computeBaselineRrfScores(
	ctx: AlgorithmContext,
): Map<string, number> {
	const semanticWindow = ctx.denseHits.slice(0, ctx.limit * 3);
	const keywordHits = filterByRelativeFloor(
		ctx.keywordHits,
		semanticWindow.length > 0 ? KEYWORD_FUSION_MIN_RELATIVE_SCORE : 0,
	);

	const scores = new Map<string, number>();

	keywordHits.forEach((hit, index) => {
		scores.set(hit.relPath, 1 / (RRF_K + index + 1));
	});

	const densePaths = uniqueDensePaths(semanticWindow);
	densePaths.forEach((relPath, rank) => {
		const vectorScore = 1 / (RRF_K + rank + 1);
		scores.set(relPath, (scores.get(relPath) ?? 0) + vectorScore);
	});

	return scores;
}

export function runBaselineRrf(ctx: AlgorithmContext): string[] {
	return [...computeBaselineRrfScores(ctx).entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, ctx.limit)
		.map(([relPath]) => relPath);
}

export const baselineRrfAlgorithm: SearchAlgorithm = {
	name: "baseline_rrf",
	description: "Production RRF (k=60, BM25 70% relative floor)",
	run: runBaselineRrf,
};

export const keywordOnlyAlgorithm: SearchAlgorithm = {
	name: "keyword_only",
	description: "Chunk BM25 only",
	run: (ctx) => ctx.keywordHits.slice(0, ctx.limit).map((hit) => hit.relPath),
};

export const denseOnlyAlgorithm: SearchAlgorithm = {
	name: "dense_only",
	description: "Dense vector only (multilingual-e5-small)",
	run: (ctx) => uniqueDensePaths(ctx.denseHits).slice(0, ctx.limit),
};
