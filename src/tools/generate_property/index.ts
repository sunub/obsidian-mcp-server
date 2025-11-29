import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { getGlobalVaultManager } from "@/utils/getVaultManager.js";
import {
	type ObsidianPropertyQueryParams,
	obsidianPropertyQueryParamsSchema,
} from "./params.js";

export const name = "generate_property";

export const annotations: ToolAnnotations = {
	title: "Obsidian Property Writer",
	openWorldHint: true,
};

export const description = `
  Analyzes the content of a specified Obsidian Markdown file to automatically generate the most suitable properties (frontmatter) and updates the file directly.

  Use Cases:
  
  - After Completing a Draft: Use when the body of the text is complete, and you want to generate all properties at once.
  - Updating Information: Use when you want to update existing properties with more accurate information reflecting the latest content.
  - Completing Missing Info: Use when you want to automatically add missing properties like tags or a summary to a document that only has a title.
  
  Parameters:
  
  filename: The name or path of the file to analyze and add properties to (e.g., "my-first-post.md").
  overwrite: If set to true, existing properties will be overwritten by the AI-generated content. Default: false.
  
  Generated Properties:
  
  The AI analyzes the context of the content to generate the following properties:
  
  - aliases: An array of alternative names or synonyms based on the content.
  - title: A title that best represents the core topic of the document.
  - tags: An array of tags extracted from the core keywords of the content (e.g., [AI, Obsidian, productivity]).
  - summary: A one to two-sentence summary of the entire document.
  - slug: A hyphenated-string suitable for URLs, containing the core keywords from the content.
  - date: The event date or creation date inferred from the content (in ISO 8601 format).
  - completed: A boolean (true or false) indicating whether the content is considered a final version.
  
  Return Value:
  
  Upon success, returns a JSON object containing a success message that includes the modified filename.
  { "status": "success", "message": "Successfully updated properties for my-first-post.md" }
  
  Requirements:
  
  The user's absolute path to the Obsidian vault must be correctly set in an environment variable.
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
		return {
			isError: true,
			content: [
				{ type: "text", text: JSON.stringify({ error: (e as Error).message }) },
			],
		};
	}
	try {
		const document = await vaultManager.getDocumentInfo(params.filename);
		if (document === null) {
			response.content.push({
				type: "text",
				text: JSON.stringify(
					{
						error: `Document not found: ${params.filename}`,
						suggestion: "Use 'list_all' action to see available documents",
						searched_filename: params.filename,
					},
					null,
					2,
				),
			});
			return response;
		}

		const documentData = {
			filename: params.filename,
			content_preview: `${document.content.substring(0, 300).replace(/\s+/g, " ")}...`,
			instructions: {
				purpose:
					"Generate or update the document's frontmatter properties based on its content.",
				usage:
					"Analyze the provided content_preview. If more detail is needed to generate accurate properties, you MUST first call the 'obsidian_vault' tool with the 'read' action to get the full document content.",
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
		response.isError = true;
		response.content.push({
			type: "text",
			text: JSON.stringify(
				{
					error: (error as Error).message,
					action: params,
					solution:
						"Ensure the VAULT_DIR_PATH environment variable is set to your Obsidian vault directory and the filename is correct.",
				},
				null,
				2,
			),
		});
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
