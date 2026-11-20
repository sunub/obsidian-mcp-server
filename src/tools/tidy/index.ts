import fs from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { toolError, toolJson } from "@shared/mcp/toolResult.js";
import {
	DEFAULT_TIDY_OPTIONS,
	type VaultToolDeps,
} from "@shared/vault-ops/index.js";
import { buildTidyPlan, TidyInputError } from "./buildPlan.js";
import { type TidyPlanParams, tidyPlanParamsSchema } from "./params.js";

export const name = "tidy_plan";

export const annotations: ToolAnnotations = {
	title: "Plan Vault Tidy",
	readOnlyHint: false,
	destructiveHint: false,
};

export const description = `
  Scans the Obsidian vault and builds a tidy plan: duplicate files, empty
  untitled notes, scattered attachments, and empty folders.

  This tool does not change any vault file. It only saves the plan (under the
  hidden .vault-tidy folder) and returns a preview.

  How to use the result:
  1. Show the preview to the user, grouped by tier:
     - bulk: low risk, the user can approve the whole group at once.
     - per_item: the user must choose each item separately.
     - report: informational only, nothing is executed.
  2. Pass only the op ids the user approved to plan_apply, together with planId.
  3. Entries in needsTitle are untitled notes with content. Read each note,
     propose a title, and pass the accepted ones to plan_apply as
     renames: [{ path, title }].

  Optional inputs: scope limits the plan to one top-level folder, planners
  selects which checks run, attachmentsFolderName sets the attachments folder
  name (default "attachments").
`;

export const register = (server: McpServer, deps: VaultToolDeps) => {
	server.registerTool(
		name,
		{
			title: annotations.title ?? name,
			description,
			inputSchema: tidyPlanParamsSchema.shape,
			annotations,
		},
		(params) => execute(params, deps),
	);
};

async function isDirectory(target: string): Promise<boolean> {
	return fs
		.stat(target)
		.then((info) => info.isDirectory())
		.catch(() => false);
}

export const execute = async (
	params: TidyPlanParams,
	deps: VaultToolDeps,
): Promise<CallToolResult> => {
	const root = deps.vaultRoot();
	if (!root) {
		return toolError(
			"VAULT_DIR_PATH is not set",
			"Set the VAULT_DIR_PATH environment variable to your Obsidian vault path.",
		);
	}
	if (!(await isDirectory(root))) {
		return toolError(`Vault path is not a directory: ${root}`);
	}
	try {
		const { preview } = await buildTidyPlan(
			root,
			{
				scope: params.scope ?? null,
				attachmentsFolderName:
					params.attachmentsFolderName ??
					DEFAULT_TIDY_OPTIONS.attachmentsFolderName,
			},
			params.planners,
		);
		return toolJson(preview);
	} catch (error) {
		if (error instanceof TidyInputError) return toolError(error.message);
		const reason = error instanceof Error ? error.message : String(error);
		return toolError(`Failed to build tidy plan: ${reason}`);
	}
};
