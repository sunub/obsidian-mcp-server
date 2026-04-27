import { debugLogger } from "@sunub/core";
import { z } from "zod";
import state from "@/config.js";

export const RerankResponseSchema = z.object({
	model: z.string(),
	object: z.string(),
	usage: z.object({
		prompt_tokens: z.number(),
		total_tokens: z.number(),
	}),
	results: z.array(
		z.object({
			index: z.number(),
			relevance_score: z.number(),
		}),
	),
});

export type RerankResult = {
	index: number;
	relevance_score: number;
	document: string;
};

class RerankerClient {
	private endpoint: string;
	private model: string;

	constructor() {
		this.endpoint = state.llmRerankerApiUrl;
		this.model = "bge-reranker-v2-m3-GGUF";
	}

	async rerank(
		query: string,
		documents: string[],
		topN: number = 5,
	): Promise<RerankResult[]> {
		if (documents.length === 0) {
			debugLogger.warn("No documents to rerank, returning empty results.");
			return [];
		}

		try {
			const response = await fetch(`${this.endpoint}/v1/rerank`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.model,
					query,
					documents,
					top_n: topN,
				}),
				signal: AbortSignal.timeout(15000), // 15초 타임아웃
			});

			if (!response.ok) {
				throw new Error(
					`Reranker API error: ${response.status} ${response.statusText}`,
				);
			}

			const data = await response.json();
			const parsed = RerankResponseSchema.parse(data);
			const rerankingResults = parsed.results.map((result) => ({
				index: result.index,
				relevance_score: this.sigmoid(result.relevance_score),
				document: documents[result.index],
			}));

			return rerankingResults
				.filter(({ relevance_score }) => relevance_score > 0.5)
				.sort((a, b) => b.relevance_score - a.relevance_score);
		} catch (error) {
			debugLogger.error(
				"Reranking failed, falling back to original order:",
				error,
			);
			return documents.map((doc, index) => ({
				index,
				relevance_score: 0,
				document: doc,
			}));
		}
	}

	private sigmoid(score: number): number {
		return 1 / (1 + Math.exp(-score));
	}
}

export const rerankerClient = new RerankerClient();
