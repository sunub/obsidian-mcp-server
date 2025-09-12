import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ObsidianPropertyQueryParams,
  obsidianPropertyQueryParamsSchema,
} from './params.js';
import { getParsedVaultPath } from '../../utils/parseVaultPath.js';
import { DocumentManager } from '../../utils/DocumentManager.js';

export const name = 'generate_obsidian_properties';

export const annotations: ToolAnnotations = {
  title: 'Obsidian Property Writer',
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
    execute
  );
};

export const execute = async (params: ObsidianPropertyQueryParams): Promise<CallToolResult> => {
  const response: CallToolResult = { content: [], isError: false };

  const vaultDirPath = getParsedVaultPath();
  try {
    const documentManager = new DocumentManager(vaultDirPath);
    const content = await documentManager.getDocumentContent(params.filename!);
    if (content === null) {
      response.content.push({
        type: 'text',
        text: JSON.stringify(
          {
            error: `Document not found: ${params.filename}`,
            suggestion: "Use 'list_all' action to see available documents",
            searched_filename: params.filename,
          },
          null,
          2
        ),
      });
      return response;
    }

    const documentData = {
      filename: params.filename,
      content: content,
      stats: {
        contentLength: content.length,
        wordCount: content.split(/\s+/).length,
        lineCount: content.split('\n').length,
      },
      example: {
        title: 'Serverless 환경에서 I/O 처리 최적화 경험기',
        date: '2025-04-03',
        tags: '[serverless, optimization]',
        summary:
          'Promise.all, Worker를 벤치마크하며 서버리스 환경에서의 I/O 처리 최적화 경험기를 공유합니다.',
        slug: 'serverless-io-optimization',
        category: 'code',
        completed: 'true',
      },
      instructions: {
        purpose: "Generate or update the document's frontmatter properties based on its content",
        usage:
          'This tool is used to analyze the content of a Markdown file and automatically generate or update its frontmatter properties to improve organization and metadata accuracy.',
        content_type: 'markdown',
        overwrite: !params.overwrite ? false : true,
        output_format: "Return a JSON object with the following structure",
        schema: {
          title: "string - Title representing the core topic",
          tags: "string[] - Array of relevant tags from content keywords",
          summary: "string - 1-2 sentence summary of the document", 
          slug: "string - URL-friendly hyphenated identifier",
          date: "string - ISO 8601 date format",
          completed: "boolean - Whether content is finalized",
          aliases: "string[] - Alternative names or synonyms (optional)",
          category: "string - Document category (optional)"
        },
      },
    };

    response.content.push({
      type: 'text',
      text: JSON.stringify(documentData, null, 2),
    });
  } catch (error) {
    response.isError = true;
    response.content.push({
      type: 'text',
      text: JSON.stringify(
        {
          error: (error as Error).message,
          action: params,
          solution:
            'Ensure the VAULT_DIR_PATH environment variable is set to your Obsidian vault directory and the filename is correct.',
        },
        null,
        2
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
