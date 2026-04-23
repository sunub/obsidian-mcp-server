import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { llmClient } from "@/utils/LLMClient.js";
import { localReranker } from "@/utils/LocalReranker.js";
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

	let diagnostic_message: string | undefined;

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

		// 1. 로컬 Reranker 시도
		const localRerankerAvailable = await localReranker.checkModelPresence();
		if (localRerankerAvailable) {
			try {
				const reranked = await localReranker.rerank(
					query,
					candidates.map((c) => c.content),
				);
				finalResults = reranked.slice(0, limit).map((r) => {
					const cand = candidates.find((c) => c.content === r.document);
					return { ...cand!, relevance_score: r.score };
				});
			} catch (err) {
				console.error("Local reranking failed:", err);
			}
		} else {
			diagnostic_message =
				"💡 [검색 품질 안내] 터미널에서 `npx obsidian-mcp-setup`을 실행하여 로컬 Reranker 모델을 설치하시면 검색 정확도가 비약적으로 향상됩니다.";

			// 2. 외부 Reranker 서버 시도 (Fallback)
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
				// Reranking fails, keep vector search results
			}
		}

		const formattedResults = finalResults
			.map((res, i) => genereateFormattedResult(res, i))
			.join("\n\n");

		let finalOutput = `Found ${finalResults.length} relevant chunks for query: "${query}"\n\n${formattedResults}`;
		if (diagnostic_message) {
			finalOutput = `<system_directive>\n${diagnostic_message}\n</system_directive>\n\n${finalOutput}`;
		}

		return {
			content: [
				{
					type: "text",
					text: finalOutput,
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
