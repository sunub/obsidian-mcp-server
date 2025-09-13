import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CreateDocumentWithPropertiesParams,
  createDocumentWithPropertiesParamsSchema,
} from './params.js';
import { getParsedVaultPath } from '../../utils/parseVaultPath.js';
import { DocumentManager } from '../../utils/DocumentManager.js';
import { obsidianPropertyOutputSchema } from '../generate_obsidian_property/params.js';
import { obsidianPropertyParamsSchema } from '../write_obsidian_property/params.js';
import { execute as writePropertyExecute } from '../write_obsidian_property/index.js';

export const name = 'create_document_with_properties';

export const annotations: ToolAnnotations = {
  title: 'Create Document with Properties',
  openWorldHint: true,
};

export const description = `
  Initiates an integrated workflow to read a document, guide an AI to generate properties, and then write those properties to a file.

  This tool acts as a workflow manager for an AI agent. It reads the content of a specified document and returns a structured, multi-step plan. The AI agent must follow this plan by first calling the 'generate_obsidian_property' tool to get the document's content for analysis, and then, after generating the properties, calling the 'write_obsidian_property' tool to save them.

  Use this tool to start the end-to-end process of enriching a document with AI-generated metadata.
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
    execute
  );
};

export const execute = async (params: CreateDocumentWithPropertiesParams): Promise<CallToolResult> => {
  const vaultDirPath = getParsedVaultPath();
  if (!vaultDirPath) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: "VAULT_DIR_PATH environment variable is not set",
          solution: "Set VAULT_DIR_PATH to your Obsidian vault directory"
        }, null, 2)
      }],
    };
  }

  try {
    const documentManager = new DocumentManager(vaultDirPath);
    const targetPath = params.outputPath || params.sourcePath;

    if (params.aiGeneratedProperties) {
      const writeResult = await writePropertyExecute({
        filePath: targetPath,
        properties: params.aiGeneratedProperties,
      });

      return writeResult;
    }

    const sourceContent = await documentManager.getDocumentContent(params.sourcePath);
    if (sourceContent === null) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Source document not found: ${params.sourcePath}`,
            suggestion: "Verify the file path and ensure the file exists. You can use the 'obsidian_vault' tool with the 'list_all' action to see all available files.",
          }, null, 2)
        }],
      };
    }

    const instructionForAI = {
      ai_prompt: "Your task is to analyze the provided text content and create a JSON object of document properties based on the requested schema. After creating the JSON object, you MUST call the 'create_document_with_properties' tool again, passing back the original parameters along with the new 'aiGeneratedProperties' parameter containing your generated JSON.",
      
      purpose: "Analyze document content and return a structured JSON object of properties.",
      
      content_to_analyze: {
        source_path: params.sourcePath,
        content_preview: sourceContent.substring(0, 4000) + (sourceContent.length > 4000 ? '...' : ''),
      },

      // AI가 다시 호출해야 할 다음 작업에 대한 명확한 명세
      next_action_required: {
        tool_to_call: name, // 바로 이 도구('create_document_with_properties')를 다시 호출
        parameters_to_add: {
          sourcePath: params.sourcePath,
          outputPath: params.outputPath,
          overwrite: params.overwrite,
          // AI가 분석한 결과를 이 파라미터에 담아서 돌려달라고 명시
          aiGeneratedProperties: "<- Insert your generated JSON object here." 
        },
        example_of_next_call: {
          tool_name: name,
          parameters: {
            sourcePath: params.sourcePath,
            aiGeneratedProperties: {
              title: "Example Title From Your Analysis",
              tags: ["tag1", "tag2"],
              summary: "An example summary you generated."
              // ... other properties
            }
          }
        }
      }
    };

    return {
      isError: false,
      content: [{
        type: 'text',
        text: JSON.stringify(instructionForAI, null, 2)
      }]
    };
    
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Failed to create workflow instruction: ${error instanceof Error ? error.message : String(error)}`,
          params: params,
        }, null, 2)
      }]
    };
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
