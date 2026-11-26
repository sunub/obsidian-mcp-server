import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { toolError, toolJson } from "@shared/mcp/toolResult.js";
import {
	type ApplyResult,
	applyPlan,
	type VaultToolDeps,
} from "@shared/vault-ops/index.js";
import { approvalMessage, type Confirmer, elicitConfirmer } from "./confirm.js";
import { type PlanApplyParams, planApplyParamsSchema } from "./params.js";
import { errorText, resolveVaultRoot } from "./vaultRoot.js";

export const name = "plan_apply";

export const annotations: ToolAnnotations = {
	title: "Apply Vault Tidy Plan",
	readOnlyHint: false,
	destructiveHint: true,
};

export const description = `
  Executes the operations of a saved tidy plan (from tidy_plan) that the user
  approved: moves files, sends files to the vault's .trash folder, removes
  empty folders, and rewrites every link so it keeps pointing at the same file.

  Pass only the op ids the user explicitly approved in the tidy_plan preview.
  Never pass ids the user did not see or approve. Report ops are never run.

  renames: titles the user accepted for needsTitle notes, as { path, title }.

  When the client supports it, the user is asked to confirm the changes before
  anything runs. A result with cancelled: true means nothing changed: do not
  retry unless the user asks.

  The result lists applied and rejected op ids (with reasons). Use its runId
  with plan_undo to revert the whole run.
`;

const EMPTY_RESULT: ApplyResult = {
	runId: "",
	applied: [],
	rejected: [],
	rewrittenLinks: 0,
	removedFolders: [],
};

export const executeApply = async (
	params: PlanApplyParams,
	deps: VaultToolDeps,
	confirm?: Confirmer,
): Promise<CallToolResult> => {
	const resolved = await resolveVaultRoot(deps);
	if ("error" in resolved) return resolved.error;

	const renames = params.renames ?? [];
	if (params.approvedOpIds.length === 0 && renames.length === 0) {
		return toolJson(EMPTY_RESULT);
	}

	try {
		const message = confirm && (await approvalMessage(resolved.root, params));
		if (message && (await confirm(message)) === "declined") {
			return toolJson({
				...EMPTY_RESULT,
				cancelled: true,
				reason: "사용자가 확인하지 않아 아무것도 바꾸지 않았습니다.",
			});
		}
		const result = await applyPlan(resolved.root, {
			planId: params.planId,
			approvedOpIds: params.approvedOpIds,
			renames,
		});
		return toolJson(result);
	} catch (error) {
		return toolError(errorText(error));
	}
};

export const registerApply = (server: McpServer, deps: VaultToolDeps) => {
	const confirm = elicitConfirmer(() => server.server);
	server.registerTool(
		name,
		{
			title: annotations.title ?? name,
			description,
			inputSchema: planApplyParamsSchema.shape,
			annotations,
		},
		(params) => executeApply(params, deps, confirm),
	);
};
