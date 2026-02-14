import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { createToolError } from "@/utils/createToolError.js";
import { getGlobalVaultManager } from "@/utils/getVaultManager.js";
import {
	type ObsidianPropertyQueryParams,
	obsidianPropertyQueryParamsSchema,
} from "./params.js";

export const name = "generate_property";

export const annotations: ToolAnnotations = {
	title: "Generate Obsidian Property",
	openWorldHint: true,
};

export const description = `
  Reads a target markdown document and returns an AI-facing payload for generating frontmatter properties.

  This tool does not write to disk. It returns content_preview and a target output schema so an AI can produce a valid property object.

  Use Cases:
  - After completing a draft, when you need property suggestions from content.
  - When missing frontmatter fields (title, tags, summary, slug, date, category, completed) should be generated.

  To apply generated properties to a file, call 'write_property' with the resulting JSON.
`;

export const register = (mcpServer: McpServer) => {
	mcpServer.registerTool(
		name,
		{
			title: annotations.title || name,
			description: description,
			inputSchema: obsidianPropertyQueryParamsSchema.shape,
			annotations: annotations,
		},
		execute,
	);
};

export const execute = async (
	params: ObsidianPropertyQueryParams,
): Promise<CallToolResult> => {
	const response: CallToolResult = { content: [], isError: false };

	let vaultManager = null;
	try {
		vaultManager = getGlobalVaultManager();
	} catch (e) {
		return createToolError((e as Error).message);
	}
	try {
		const document = await vaultManager.getDocumentInfo(params.filename);
		if (document === null) {
			return createToolError(
				`Document not found: ${params.filename}`,
				"Use 'list_all' action to see available documents",
			);
		}

		const documentData = {
			filename: params.filename,
			content_preview: `${document.content.substring(0, 300).replace(/\s+/g, " ")}...`,
			instructions: {
				purpose:
					"Generate or update the document's frontmatter properties based on its content.",
				usage:
					"Analyze the provided content_preview. If more detail is needed to generate accurate properties, you MUST call the 'vault' tool with action='read' to get the full document content.",
				content_type: "markdown",
				overwrite: params.overwrite || false,
				output_format: "Return a JSON object with the following structure",
				schema: {
					title: "string - Title representing the core topic",
					tags: "string[] - Array of relevant tags from content keywords",
					summary: "string - 1-2 sentence summary of the document",
					slug: "string - URL-friendly hyphenated identifier",
					date: "string - ISO 8601 date format",
					completed: "boolean - Whether content is finalized",
					aliases: "string[] - (Optional) Alternative names or synonyms",
					category: "string - (Optional) Document category",
				},
			},
		};

		response.content.push({
			type: "text",
			text: JSON.stringify(documentData, null, 2),
		});
	} catch (error) {
		return createToolError(
			(error as Error).message,
			"Ensure the VAULT_DIR_PATH environment variable is set to your Obsidian vault directory and the filename is correct.",
		);
	}
	return response;
};

export default {
	name,
	description,
	annotations,
	inputSchema: obsidianPropertyQueryParamsSchema.shape,
	execute,
	register,
};
