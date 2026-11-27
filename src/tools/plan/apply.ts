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
  Applies selected operations (approvedOpIds) and note renames (renames:
  [{ path, title }]) from a saved tidy_plan (planId): moves files, moves
  trashed files to .trash, removes empty folders, and rewrites vault links.
  Report ops are ignored.

  Requests client confirmation before executing when supported; returns
  cancelled: true if declined with no files changed. Returns applied and
  rejected op ids, rewritten link count, removed folders, and a runId for
  plan_undo.
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
