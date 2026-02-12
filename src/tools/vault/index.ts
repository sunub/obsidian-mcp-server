import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import state from "@/config.js";
import { createToolError } from "@/utils/createToolError.js";
import { getGlobalVaultManager } from "@/utils/getVaultManager.js";
import {
	type ObsidianContentQueryParams,
	obsidianContentQueryParamsZod,
} from "./params.js";
import {
	listAllDocuments,
	readSpecificFile,
	searchDocuments,
	statsAllDocuments,
} from "./utils.js";

export const name = "vault";

export const annotations: ToolAnnotations = {
	title: "Obsidian Content Getter",
	openWorldHint: true,
};

export const description = `
  Retrieves and searches the content of Markdown (.md, .mdx) documents stored in an Obsidian vault. Use this tool to find notes related to a specific topic or keyword and understand their core content.

  When to use:
  - When you need to find a specific note by its title or a keyword to check its content.
  - When you want to synthesize and summarize information scattered across multiple notes.
  - When looking for answers to questions based on your saved records, such as "What was the project deadline?"
  - To discover connections by finding all notes that link to a specific note.
  - When you need to retrieve a list of unfinished tasks (- [ ]) from daily notes or meeting minutes.

  Returns the content of the most relevant document(s) in text format. It can also include metadata such as the document's title, tags, and creation date.

  Requirements: The user's Obsidian Vault path must be correctly configured in an environment variable or a similar setting. For searches, use the exact filename or include core keywords for content-based queries.
`;

export const register = (mcpServer: McpServer) => {
	mcpServer.registerTool(
		name,
		{
			title: annotations.title || name,
			description: description,
			inputSchema: obsidianContentQueryParamsZod.shape,
			annotations: annotations,
		},
		execute,
	);
};

export const execute = async (
	params: ObsidianContentQueryParams,
): Promise<CallToolResult> => {
	const vaultDirPath = state.vaultPath;

	// Vault 경로 검증
	if (!vaultDirPath) {
		return createToolError(
			"VAULT_DIR_PATH environment variable is not set",
			"Set VAULT_DIR_PATH to your Obsidian vault directory",
		);
	}

	let vaultManager = null;
	try {
		vaultManager = getGlobalVaultManager();
	} catch (e) {
		return createToolError((e as Error).message);
	}

	try {
		switch (params.action) {
			case "search":
				if (!params.keyword?.trim()) {
					return createToolError(
						"keyword parameter is required for search action",
						'Provide a keyword, e.g. { action: "search", keyword: "project" }',
					);
				}
				return await searchDocuments(vaultManager, params);

			case "read":
				if (!params.filename?.trim()) {
					return createToolError(
						"filename parameter is required for read action",
						'Provide a filename, e.g. { action: "read", filename: "meeting-notes.md" }',
					);
				}
				return await readSpecificFile(vaultManager, params);

			case "list_all":
				return await listAllDocuments(vaultManager, params);

			case "stats":
				return await statsAllDocuments(vaultManager);

			default:
				return createToolError(
					`Unknown action: ${params.action}`,
					"Valid actions are: search, read, list_all, stats",
				);
		}
	} catch (error) {
		return createToolError(
			`Execution failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

export default {
	name,
	description,
	annotations,
	inputSchema: obsidianContentQueryParamsZod.shape,
	execute,
	register,
};
