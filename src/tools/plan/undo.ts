import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { toolError, toolJson } from "@shared/mcp/toolResult.js";
import { undoRun, type VaultToolDeps } from "@shared/vault-ops/index.js";
import { type PlanUndoParams, planUndoParamsSchema } from "./params.js";
import { errorText, resolveVaultRoot } from "./vaultRoot.js";

export const name = "plan_undo";

export const annotations: ToolAnnotations = {
	title: "Undo Vault Tidy Run",
	readOnlyHint: false,
	destructiveHint: true,
};

export const description = `
  Reverts a plan_apply run by runId: restores moved and trashed files,
  restores rewritten note contents, and recreates removed folders.

  Entries modified after the run are skipped and returned in conflicts instead
  of being overwritten. Each run can be undone only once.
`;

export const executeUndo = async (
	params: PlanUndoParams,
	deps: VaultToolDeps,
): Promise<CallToolResult> => {
	const resolved = await resolveVaultRoot(deps);
	if ("error" in resolved) return resolved.error;

	try {
		return toolJson(await undoRun(resolved.root, params.runId));
	} catch (error) {
		return toolError(errorText(error));
	}
};

export const registerUndo = (server: McpServer, deps: VaultToolDeps) => {
	server.registerTool(
		name,
		{
			title: annotations.title ?? name,
			description,
			inputSchema: planUndoParamsSchema.shape,
			annotations,
		},
		(params) => executeUndo(params, deps),
	);
};
