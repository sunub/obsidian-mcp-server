import { z } from 'zod';

export const responseTypeSchema = z.enum(['text', 'audio', 'image', 'resource', 'resouce_link']).describe('The type of content being returned');
const quietMode = z.boolean().default(true).describe('If true, suppresses non-error output messages. Default is false.');

export const obsidianContentQueryParams = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['search', 'read', 'list_all', 'stats'],
      description: 'The action to perform: search documents, read specific file, list all content, or get stats'
    },
    keyword: {
      type: 'string',
      description: 'Keyword to search for in documents (required for search action)'
    },
    filename: {
      type: 'string',
      description: 'Specific filename to read (required for read action)'
    },
    limit: {
      type: 'number',
      minimum: 1,
      maximum: 100,
      description: 'Maximum number of results to return (default: 10 for search, unlimited for others)'
    },
    includeContent: {
      type: 'boolean',
      description: 'Whether to include document content in search results (default: true)'
    },
    includeFrontmatter: {
      type: 'boolean',
      description: 'Whether to include frontmatter metadata in results (default: false)'
    },
    excerptLength: {
      type: 'number',
      minimum: 100,
      maximum: 2000,
      description: 'Length of content excerpt to include in search results (default: 500)'
    }
  },
  required: ['action'],
  additionalProperties: false
} as const;

// input properties schema
export const obsidianContentActions = z.enum(['search', 'read', 'list_all', 'stats']).describe('The action to perform: search documents, read specific file, list all content, or get stats');
export const obsidianContentKeyword = z.string().describe('Keyword to search for in documents (required for search action)');
export const obsidianContentFilename = z.string().describe('Specific filename to read (required for read action)');
export const obsidianContentLimit = z.number().min(1).max(100).describe('Maximum number of results to return (default: 10 for search, unlimited for others)');
export const obsidianContentIncludeContent = z.boolean().default(true).describe('Whether to include document content in search results (default: true)');
export const obsidianContentIncludeFrontmatter = z.boolean().default(false).describe('Whether to include frontmatter metadata in results (default: false)');
export const obsidianContentExcerptLength = z.number().min(100).max(2000).default(500).describe('Length of content excerpt to include in search results (default: 500)');

// input schema
export const obsidianContentQueryParamsZod = z.object({
  action: obsidianContentActions,
  keyword: obsidianContentKeyword.optional(),
  filename: obsidianContentFilename.optional(),
  limit: obsidianContentLimit.optional(),
  includeContent: obsidianContentIncludeContent.optional(),
  includeFrontmatter: obsidianContentIncludeFrontmatter.optional(),
  excerptLength: obsidianContentExcerptLength.optional(),
  quiet: quietMode.optional(),
});

export type ObsidianContentQueryParams = z.infer<typeof obsidianContentQueryParamsZod>;

export const aiInstructionsSchema = z.object({
  purpose: z.string().describe('The purpose of providing this content to the AI'),
  usage: z.string().describe('How the AI should use this content'),
  content_type: z.string().describe('The format of the content, e.g., markdown')
}).describe('Instructions for AI on how to process the document content');

export const metadataSchema = z.object({
  fullPath: z.string().describe('The full path to the file in the vault'),
  title: z.string().nullable().describe('The title of the document, if available'),
  tags: z.array(z.string()).describe('List of tags associated with the document'),
  category: z.string().describe('Category of the document, if available'),
  date: z.string().nullable().describe('Creation date of the document in ISO 8601 format, if available'),
  summary: z.string().nullable().describe('Brief summary or abstract of the document, if available'),
  completed: z.boolean().describe('Indicates whether a task or item is completed')
}).describe('Metadata extracted from the document frontmatter, if available');
