export const DEFAULT_LOW_CONFIDENCE_DENSE_THRESHOLD = 0.88;

export interface LowConfidenceInput {
	hasSemanticSearch: boolean;
	topDenseSimilarity: number;
	topBm25Score: number;
	threshold?: number | undefined;
}

export function isLowConfidence(input: LowConfidenceInput): boolean {
	const threshold = input.threshold ?? DEFAULT_LOW_CONFIDENCE_DENSE_THRESHOLD;
	if (threshold <= 0 || !input.hasSemanticSearch) {
		return false;
	}
	return input.topBm25Score === 0 && input.topDenseSimilarity < threshold;
}
