import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { llmClient } from "@/utils/LLMClient.js";
import { rerankerClient } from "@/utils/RerankerClient.js";
import { type ChunkMetadata, vectorDB } from "@/utils/VectorDB.js";
import type { ObsidianContentQueryParams } from "../../params.js";

function genereateFormattedResult(
	res: ChunkMetadata & { relevance_score: number },
	index: number,
): string {
	const fileStr = `File: ${res.fileName}`;
	const pathStr = `Path: ${res.filePath}`;
	const scoreStr = `Relevance: ${(res.relevance_score * 100).toFixed(2)}%`;
	const contextStr = `Context: ${res.context || "N/A"}`;
	const contentStr = `Content:\n---\n${res.content}\n---`;
	return [
		`[Result ${index + 1}]`,
		fileStr,
		pathStr,
		scoreStr,
		contextStr,
		contentStr,
	].join("\n");
}

export const searchSemantic = async (
	params: ObsidianContentQueryParams,
): Promise<CallToolResult> => {
	const { query, limit = 5 } = params;

	if (!query) {
		throw new Error("query is required for semantic search");
	}

	try {
		const queryVector = await llmClient.generateEmbedding(
			`search_query: ${query}`,
		);

		const candidates = await vectorDB.search(queryVector, limit * 4);
		if (candidates.length === 0) {
			return {
				content: [{ type: "text", text: "No relevant documents found." }],
			};
		}

		let finalResults = candidates
			.slice(0, limit)
			.map((c) => ({ ...c, relevance_score: 0 }));

		try {
			const rerankedResults = await rerankerClient.rerank(
				query,
				candidates.map((c) => c.content),
				limit,
			);

			finalResults = rerankedResults.map((r) => ({
				...candidates[r.index],
				relevance_score: r.relevance_score,
			}));
		} catch (rerankError) {
			console.error(
				"Reranking failed, falling back to vector search results:",
				rerankError,
			);
			// Reranking fails, keep vector search results
		}

		const formattedResults = finalResults
			.map((res, i) => genereateFormattedResult(res, i))
			.join("\n\n");

		return {
			content: [
				{
					type: "text",
					text: `Found ${finalResults.length} relevant chunks for query: "${query}"\n\n${formattedResults}`,
				},
			],
		};
	} catch (error) {
		console.error("Semantic search failed:", error);
		return {
			content: [
				{
					type: "text",
					text: `Semantic search is currently unavailable. Please check if your embedding server (e.g., Ollama or llama.cpp) is running.\nError: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
			isError: true,
		};
	}
};
