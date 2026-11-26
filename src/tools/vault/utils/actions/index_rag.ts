import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ragIndexer } from "@shared/indexing/RAGIndexer.js";
import { vectorDB } from "@shared/indexing/VectorDB.js";
import state from "@/config.js";

export const triggerIndexing = async (): Promise<CallToolResult> => {
	const vaultPath = state.vaultPath;

	if (!vaultPath) {
		throw new Error("Vault path is not configured.");
	}

	try {
		await vectorDB.checkAndMigrateIfNeeded();
		await ragIndexer.indexAll(vaultPath);
		await vectorDB.createVectorIndex();

		return {
			content: [
				{
					type: "text",
					text: `Successfully indexed all documents in vault: ${vaultPath}`,
				},
			],
		};
	} catch (error) {
		console.error("Full indexing failed:", error);
		throw error;
	}
};
