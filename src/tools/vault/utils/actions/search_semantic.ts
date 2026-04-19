import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { llmClient } from "../../../../utils/LLMClient.js";
import { type ChunkMetadata, vectorDB } from "../../../../utils/VectorDB.js";
import type { ObsidianContentQueryParams } from "../../params.js";

export const searchSemantic = async (
	params: ObsidianContentQueryParams,
): Promise<CallToolResult> => {
	const { query, limit = 5 } = params;

	if (!query) {
		throw new Error("query is required for semantic search");
	}

	try {
		// 1. Embed the user query
		// nomic-embed-text requires 'search_query: ' prefix for queries
		const queryVector = await llmClient.generateEmbedding(`search_query: ${query}`);

		// 2. Search LanceDB
		const results = await vectorDB.search(queryVector, limit);

		if (results.length === 0) {
			return {
				content: [{ type: "text", text: "No relevant documents found." }],
			};
		}

		// 3. Format results
		const formattedResults = results
			.map((res: ChunkMetadata & { _distance: number }, i: number) => {
				return `[Result ${i + 1}]
File: ${res.fileName}
Path: ${res.filePath}
Distance: ${res._distance.toFixed(4)}
Context: ${res.context || "N/A"}
Content:
---
${res.content}
---`;
			})
			.join("\n\n");

		return {
			content: [
				{
					type: "text",
					text: `Found ${results.length} relevant chunks for query: "${query}"\n\n${formattedResults}`,
				},
			],
		};
	} catch (error) {
		console.error("Semantic search failed:", error);
		throw error;
	}
};
