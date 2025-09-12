import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { obsidianContentQueryParamsZod, type ObsidianContentQueryParams } from './params.js';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DocumentManager } from '../../utils/DocumentManager.js';
import { getParsedVaultPath } from '../../utils/parseVaultPath.js';
import { listAllDocuments, readSpecificFile, searchDocuments, statsAllDocuments } from './utils.js';

export const name = 'obsidian_vault';

export const annotations: ToolAnnotations = {
  title: 'Obsidian Content Getter',
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
    execute
  );
};

export const execute = async (params: ObsidianContentQueryParams): Promise<CallToolResult> => {
  const vaultDirPath = getParsedVaultPath();
  
  // Vault 경로 검증
  if (!vaultDirPath) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: "VAULT_DIR_PATH environment variable is not set",
          action: params.action,
          solution: "Set VAULT_DIR_PATH to your Obsidian vault directory"
        }, null, 2)
      }],
      isError: true
    };
  }

  try {
    const documentManager = new DocumentManager(vaultDirPath);

    // 액션별 파라미터 검증
    switch (params.action) {
      case 'search':
        if (!params.keyword?.trim()) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: "keyword parameter is required for search action",
                action: params.action,
                example: { action: "search", keyword: "project", includeContent: true }
              }, null, 2)
            }],
            isError: true
          };
        }
        return await searchDocuments(documentManager, params);

      case 'read':
        if (!params.filename?.trim()) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: "filename parameter is required for read action",
                action: params.action,
                example: { action: "read", filename: "meeting-notes.md" }
              }, null, 2)
            }],
            isError: true
          };
        }
        return await readSpecificFile(documentManager, params);

      case 'list_all':
        return await listAllDocuments(documentManager, params);

      case 'stats':
        return await statsAllDocuments(documentManager);

      default:
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: `Unknown action: ${params.action}`,
              valid_actions: ['search', 'read', 'list_all', 'stats'],
              action: params.action
            }, null, 2)
          }],
          isError: true
        };
    }

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Execution failed: ${error instanceof Error ? error.message : String(error)}`,
          action: params.action,
          vault_path: vaultDirPath,
          timestamp: new Date().toISOString()
        }, null, 2)
      }],
      isError: true
    };
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
