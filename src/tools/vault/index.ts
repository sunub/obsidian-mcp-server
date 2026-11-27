import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { createToolError } from "@shared/mcp/createToolError.js";
import { getGlobalVaultManager } from "@shared/vault-manager/getVaultManager.js";
import state from "@/config.js";
import { recordVaultResponseMetric } from "./metrics.js";
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

  search returns up to limit matching notes (default 10), best match first,
  each with its path, title, tags, and a snippet of at most 200 characters when
  the note body matched. It does not return note bodies: call read with
  filename set to a returned path. To synthesize information across several
  notes, search first, then read each note you need.

  Requirements: The user's Obsidian Vault path must be correctly configured in an environment variable or a similar setting. For searches, use the exact filename or include core keywords for content-based queries.

  Search results include search_status. mode "keyword" means semantic search did
  not contribute, so results may miss related notes; reason says why. When
  search quality matters to the user, you can mention setup_command. indexing is
  present while the semantic index is still being built. reason "low_confidence"
  means no keyword matched and semantic similarity was weak: check that the
  results are relevant before answering from them, and do not treat them as proof
  that the vault covers the topic.
`;

export const register = (mcpServer: McpServer) => {
	mcpServer.registerTool(
		name,
		{
			title: annotations.title || name,
			description: description,
			inputSchema: obsidianContentQueryParamsZod,
			annotations: annotations,
		},
		execute,
	);
};

export const execute = async (
	params: ObsidianContentQueryParams,
): Promise<CallToolResult> => {
	const vaultDirPath = state.vaultPath;

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
		let result: CallToolResult;
		switch (params.action) {
			case "search":
				if (!params.keyword?.trim()) {
					return createToolError(
						"keyword parameter is required for search action",
						'Provide a keyword, e.g. { action: "search", keyword: "project" }',
					);
				}
				result = await searchDocuments(vaultManager, params);
				break;

			case "read":
				if (!params.filename?.trim()) {
					return createToolError(
						"filename parameter is required for read action",
						'Provide a filename, e.g. { action: "read", filename: "meeting-notes.md" }',
					);
				}
				result = await readSpecificFile(vaultManager, params);
				break;

			case "list_all":
				result = await listAllDocuments(vaultManager, params);
				break;

			case "stats":
				result = await statsAllDocuments(vaultManager);
				break;

			default:
				return createToolError(
					`Unknown action: ${params.action}`,
					"Valid actions are: search, read, list_all, stats",
				);
		}

		await recordVaultResponseMetric(params.action, result);
		return result;
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
	inputSchema: obsidianContentQueryParamsZod,
	execute,
	register,
};
