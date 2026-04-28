import { debugLogger } from "@sunub/obsidian-mcp-core";
import { z } from "zod";
import state from "@/config.js";
import { localReranker } from "@/utils/LocalReranker.js";

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

		// 1. 로컬 리랭커 사용 시도 (우선순위)
		try {
			const isLocalAvailable = await localReranker.checkModelPresence();
			if (isLocalAvailable) {
				const results = await localReranker.rerank(query, documents);
				return results
					.map((r) => ({
						index: documents.indexOf(r.document),
						relevance_score: r.score,
						document: r.document,
					}))
					.slice(0, topN);
			}
		} catch (error) {
			console.warn(
				"[RerankerClient] Local reranker failed, falling back to server:",
				error,
			);
		}

		// 2. 외부 API 서버 사용 (폴백)
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
