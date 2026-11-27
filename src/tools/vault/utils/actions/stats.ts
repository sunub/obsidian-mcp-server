import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { localEmbedder } from "@shared/local-ai/Embedder.js";
import { SEARCH_SETUP_COMMAND } from "@shared/searchStatus.js";
import type { VaultManager } from "@shared/vault-manager/VaultManager.js";

export async function statsAllDocuments(
	vaultManager: VaultManager,
): Promise<CallToolResult> {
	await vaultManager.initialize();
	const embedderReady = await localEmbedder.checkModelPresence();
	const stats = vaultManager.getStats();
	const payload = {
		...stats,
		localModels: {
			embedderReady,
		},
		...(!embedderReady ? { setupCommand: SEARCH_SETUP_COMMAND } : {}),
	};
	return {
		isError: false,
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
	};
}
