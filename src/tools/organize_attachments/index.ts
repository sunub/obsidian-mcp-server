import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import state from "@/config.js";
import { getGlobalVaultManager } from "@/utils/getVaultManager.js";
import {
	type OrganizeAttachmentsParams,
	organizeAttachmentsParamsSchema,
} from "./params.js";
import { genreateOrganizationTasks } from "./utils.js";

export const name = "organize_attachments";

export const annotations: ToolAnnotations = {
	title: "Organize Attachments",
	openWorldHint: true,
};

export const description = `
  Scans a specified markdown file for linked images (or other attachments),
  moves them to a dedicated folder named after the document's title,
  and updates the links within the markdown file automatically.

  Use Cases:
  - When a post is finalized and you want to clean up all associated images into a neat folder.
  - To automatically organize attachments for better vault management.

  Example Workflow:
  1. Specify 'my-awesome-post.md' as the fileName.
  2. The tool finds the 'title' property in the frontmatter (e.g., "My Awesome Post").
  3. It finds all image links like ![[my-image.png]].
  4. It creates a folder at '{vault}/images/My Awesome Post/'.
  5. It moves 'my-image.png' into that new folder.
  6. It updates the link in the markdown file to ![[images/My Awesome Post/my-image.png]].
`;

export const register = (mcpServer: McpServer) => {
	mcpServer.registerTool(
		name,
		{
			title: annotations.title || name,
			description: description,
			inputSchema: organizeAttachmentsParamsSchema.shape,
			annotations: annotations,
		},
		execute,
	);
};

export const execute = async (
	params: OrganizeAttachmentsParams,
): Promise<CallToolResult> => {
	const vaultDirPath = state.vaultPath;
	if (!vaultDirPath) {
		return {
			isError: true,
			content: [
				{
					type: "text",
					text: JSON.stringify({ error: "VAULT_DIR_PATH is not set" }),
				},
			],
		};
	}

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
		await vaultManager.initialize();

		const documents = await vaultManager.searchDocuments(params.keyword);
		if (documents.length === 0) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: JSON.stringify({
							error: `No document found for keyword: ${params.keyword}`,
						}),
					},
				],
			};
		}

		const organizationTasks = genreateOrganizationTasks(
			documents,
			vaultDirPath,
		);
		const results = await Promise.all(organizationTasks.map((task) => task()));

		return {
			isError: false,
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							summary: `Processed ${documents.length} document(s).`,
							details: results,
						},
						null,
						2,
					),
				},
			],
		};
	} catch (error) {
		return {
			isError: true,
			content: [
				{
					type: "text",
					text: JSON.stringify({ error: (error as Error).message }, null, 2),
				},
			],
		};
	}
};

export default {
	name,
	description,
	annotations,
	inputSchema: organizeAttachmentsParamsSchema.shape,
	execute,
	register,
};
