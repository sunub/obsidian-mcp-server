import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import state from "@/config.js";
import { createToolError } from "@/utils/createToolError.js";
import { getGlobalVaultManager } from "@/utils/getVaultManager.js";
import { execute as writePropertyExecute } from "../write_property/index.js";
import {
	type CreateDocumentWithPropertiesParams,
	createDocumentWithPropertiesParamsSchema,
} from "./params.js";

export const name = "create_document_with_properties";

export const annotations: ToolAnnotations = {
	title: "Create Document with Properties",
	openWorldHint: true,
};

export const description = `
  Starts and completes a two-step workflow for AI-generated frontmatter properties.

  Step 1: Call this tool with sourcePath (and optional outputPath). It returns a structured instruction payload and a content preview for AI analysis.
  Step 2: Call this same tool again with aiGeneratedProperties. The tool then writes those properties by executing the same write logic used by the 'write_property' tool.

  Use this tool when an AI agent should orchestrate analysis and write in a consistent workflow.
`;

export const register = (mcpServer: McpServer) => {
	mcpServer.registerTool(
		name,
		{
			title: annotations.title || name,
			description: description,
			inputSchema: createDocumentWithPropertiesParamsSchema.shape,
			annotations: annotations,
		},
		execute,
	);
};

export const execute = async (
	params: CreateDocumentWithPropertiesParams,
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
		const targetPath = params.outputPath || params.sourcePath;

		if (params.aiGeneratedProperties) {
			const writeResult = await writePropertyExecute({
				filePath: targetPath,
				properties: params.aiGeneratedProperties,
				quiet: params.quiet || false,
			});

			return writeResult;
		}

		const document = await vaultManager.getDocumentInfo(params.sourcePath);
		if (document === null) {
			return createToolError(
				`Source document not found: ${params.sourcePath}`,
				"Verify the file path and ensure the file exists. Use the vault tool with 'list_all' action to see all available files.",
			);
		}

		const instructionForAI = {
			ai_prompt:
				"Your task is to analyze the provided text content and create a JSON object of document properties based on the requested schema. After creating the JSON object, you MUST call the 'create_document_with_properties' tool again, passing back the original parameters along with the new 'aiGeneratedProperties' parameter containing your generated JSON.",

			purpose:
				"Analyze document content and return a structured JSON object of properties.",

			content_to_analyze: {
				source_path: params.sourcePath,
				content_preview:
					document.content.substring(0, 2000) +
					(document.content.length > 2000 ? "..." : ""),
			},

			// AI가 다시 호출해야 할 다음 작업에 대한 명확한 명세
			next_action_required: {
				tool_to_call: name, // 바로 이 도구('create_document_with_properties')를 다시 호출
				parameters_to_add: {
					sourcePath: params.sourcePath,
					outputPath: params.outputPath,
					overwrite: params.overwrite,
					quiet: params.quiet,
					aiGeneratedProperties: "<- Insert your generated JSON object here.",
				},
				example_of_next_call: {
					tool_name: name,
					parameters: {
						sourcePath: params.sourcePath,
						aiGeneratedProperties: {
							title: "Serverless 환경에서 I/O 처리 최적화 경험기",
							date: "2025-04-03",
							tags: ["serverless", "optimization"],
							summary:
								"Promise.all, Worker를 벤치마크하며 서버리스 환경에서의 I/O 처리 최적화 경험기를 공유합니다.",
							slug: "serverless-io-optimization",
							category: "code",
							completed: true,
						},
					},
				},
			},
		};

		return {
			isError: false,
			content: [
				{
					type: "text",
					text: JSON.stringify(instructionForAI, null, 2),
				},
			],
		};
	} catch (error) {
		return createToolError(
			`Failed to create workflow instruction: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

export default {
	name,
	description,
	annotations,
	inputSchema: createDocumentWithPropertiesParamsSchema.shape,
	execute,
	register,
};
