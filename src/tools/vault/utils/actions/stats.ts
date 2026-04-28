import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VaultManager } from "../../../../utils/VaultManger/VaultManager.js";

export async function statsAllDocuments(
	vaultManager: VaultManager,
): Promise<CallToolResult> {
	await vaultManager.initialize();
	const stats = vaultManager.getStats();
	return {
		isError: false,
		content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
	};
}
