import fs from "node:fs/promises";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toolError } from "@shared/mcp/toolResult.js";
import type { VaultToolDeps } from "@shared/vault-ops/index.js";

export async function resolveVaultRoot(
	deps: VaultToolDeps,
): Promise<{ root: string } | { error: CallToolResult }> {
	const root = deps.vaultRoot();
	if (!root) {
		return {
			error: toolError(
				"VAULT_DIR_PATH is not set",
				"Set the VAULT_DIR_PATH environment variable to your Obsidian vault path.",
			),
		};
	}
	const isDirectory = await fs
		.stat(root)
		.then((info) => info.isDirectory())
		.catch(() => false);
	if (!isDirectory) {
		return { error: toolError(`Vault path is not a directory: ${root}`) };
	}
	return { root };
}

export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
