import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CreateDocumentWithPropertiesParams,
  createDocumentWithPropertiesParamsSchema,
} from './params.js';
import { getParsedVaultPath } from '../../utils/parseVaultPath.js';
import { DocumentManager } from '../../utils/DocumentManager.js';

// Internal imports for the workflow tools
import { execute as generatePropertiesExecute } from '../generate_obsidian_property/index.js';
import { execute as writePropertyExecute } from '../write_obsidian_property/index.js';

export const name = 'create_document_with_properties';

export const annotations: ToolAnnotations = {
  title: 'Create Document with Properties',
  openWorldHint: true,
};

export const description = `
  Integrated workflow tool that combines reading a source document, analyzing its content to generate appropriate properties, and writing those properties to either the same file or a new output file.

  This tool encapsulates the complete workflow of:
  1. Reading content from the source document
  2. Analyzing the content using AI to generate optimal frontmatter properties
  3. Writing the generated properties to the target file

  Use Cases:
  
  - Draft Processing: Convert a draft document without properties into a finalized document with complete frontmatter
  - Batch Processing: Process multiple documents in a consistent manner
  - Content Migration: Move content between files while ensuring proper metadata
  - Template Application: Apply consistent property structure across documents
  
  Parameters:
  
  - sourcePath (string, required): The path to the source markdown file to read and analyze
    Example: "drafts/my-article.md" or "notes/research-notes.md"
  
  - outputPath (string, optional): The path where the processed file with properties will be saved
    - If provided: Creates/updates the file at the specified path
    - If not provided: Updates the source file in place
    Example: "published/my-article.md"
  
  - overwrite (boolean, optional): Whether to overwrite existing properties
    - true: AI-generated properties will replace existing ones
    - false (default): AI-generated properties will be merged with existing ones
  
  Generated Properties:
  
  The AI analyzes the source content to automatically generate:
  
  - title: A descriptive title representing the core topic
  - tags: Relevant tags extracted from content keywords
  - summary: A concise 1-2 sentence summary
  - slug: URL-friendly identifier derived from the title
  - date: Document creation or event date (ISO 8601 format)
  - completed: Boolean indicating content finalization status
  - aliases: Alternative names or synonyms (optional)
  - cssclasses: CSS classes for styling (optional)
  - category: Document classification (optional)
  
  Return Value:
  
  Upon success, returns a comprehensive result including operation status, file paths, generated properties, and processing statistics.
  
  Requirements:
  
  - The Obsidian vault path must be correctly configured in environment variables
  - The source file must exist and be readable
  - Write permissions are required for the target location
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

    // 1. Read source document content
    const sourceContent = await documentManager.getDocumentContent(params.sourcePath);
    if (sourceContent === null) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Source document not found: ${params.sourcePath}`,
            suggestion: "Verify the file path and ensure the file exists",
          }, null, 2)
        }],
      };
    }
    
    // If outputPath is provided and different, copy content to the new path first.
    // This ensures the new file exists before properties are added.
    if (params.outputPath && params.outputPath !== params.sourcePath) {
        await documentManager.writeDocumentWithFrontmatter(params.outputPath, {}, sourceContent);
    }

    // 2. Prepare a clear, actionable instruction for the AI
    const instructionForAI = {
      purpose: "Generate document properties and write them to a file.",
      step_1_analysis: {
        message: "The content of the source document is provided below.",
        sourcePath: params.sourcePath,
        content: sourceContent.substring(0, 4000) + (sourceContent.length > 4000 ? '...' : ''), // Provide a snippet
      },
      step_2_action: {
        message: "Analyze the content and generate a JSON object for the properties. Then, call the 'write_obsidian_property' tool to write these properties to the target file.",
        tool_to_call: "write_obsidian_property",
        parameters_to_use: {
          filePath: targetPath,
          properties: {
            title: "string - A descriptive title for the document.",
            tags: "string[] - An array of relevant tags.",
            summary: "string - A 1-2 sentence summary.",
            slug: "string - A URL-friendly slug.",
            date: "string - The creation or event date (ISO 8601 format).",
            completed: "boolean - The finalization status of the document.",
            aliases: "string[] - (Optional) Alternative names or synonyms.",
            category: "string - (Optional) The document's category."
          }
        }
      },
      example_tool_call: {
        tool_name: "write_obsidian_property",
        parameters: {
          filePath: targetPath,
          properties: {
            title: "My Awesome Article",
            tags: ["tech", "writing", "ai"],
            summary: "This article discusses how to effectively use AI tools in writing.",
            slug: "my-awesome-article",
            date: new Date().toISOString().split('T')[0],
            completed: false
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
          error: `Workflow instruction failed: ${error instanceof Error ? error.message : String(error)}`,
          params: params,
        }, null, 2)
      }]
    };
  }
};

// Helper functions for content analysis
function extractTitleFromContent(content: string): string {
  // Extract title from first heading or first significant line
  const lines = content.split('\n').filter(line => line.trim());
  
  // Look for first H1 heading
  const h1Match = lines.find(line => line.startsWith('# '));
  if (h1Match) {
    return h1Match.replace('# ', '').trim();
  }
  
  // Look for any heading
  const headingMatch = lines.find(line => line.match(/^#{1,6}\s+/));
  if (headingMatch) {
    return headingMatch.replace(/^#{1,6}\s+/, '').trim();
  }
  
  // Use first non-empty line as fallback
  const firstLine = lines[0];
  return firstLine ? firstLine.substring(0, 50).trim() : 'Untitled Document';
}

function extractTagsFromContent(content: string): string[] {
  const words = content.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3);
  
  // Simple frequency analysis for tag extraction
  const wordCount: Record<string, number> = {};
  words.forEach(word => {
    wordCount[word] = (wordCount[word] || 0) + 1;
  });
  
  // Get most frequent words as tags
  return Object.entries(wordCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([word]) => word)
    .filter(word => word.length > 3);
}

function extractSummaryFromContent(content: string): string {
  // Extract first paragraph or first few sentences
  const sentences = content
    .replace(/#{1,6}\s+[^\n]+\n/g, '') // Remove headings
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);
  
  if (sentences.length === 0) {
    return 'Document content summary not available.';
  }
  
  // Take first two sentences or first sentence if long enough
  const summary = sentences.length > 1 
    ? `${sentences[0]}. ${sentences[1]}.`
    : `${sentences[0]}.`;
    
  return summary.substring(0, 200).trim();
}

function generateSlugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function assessContentCompleteness(content: string): boolean {
  // Simple heuristics for content completeness
  const wordCount = content.split(/\s+/).length;
  const hasConclusion = /conclusion|결론|마무리|정리/i.test(content);
  const hasStructure = /#{1,6}/.test(content); // Has headings
  
  return wordCount > 500 && (hasConclusion || hasStructure);
}

export default {
  name,
  description,
  annotations,
  inputSchema: createDocumentWithPropertiesParamsSchema.shape,
  execute,
  register,
};
