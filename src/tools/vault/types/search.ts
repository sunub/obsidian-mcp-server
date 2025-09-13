import { z } from 'zod';

// Schema for document metadata
const DocumentMetadataSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  category: z.string(),
  date: z.string().nullable(),
  summary: z.string().nullable(),
  completed: z.boolean(),
});

// Schema for document stats
const DocumentStatsSchema = z.object({
  contentLength: z.number(),
  hasContent: z.boolean(),
  wordCount: z.number(),
});

// Schema for content when includeContent is true
const FullContentSchema = z.object({
  full: z.string(),
  excerpt: z.string(),
});

// Schema for content when includeContent is false
const PreviewContentSchema = z.object({
  preview: z.string(),
  note: z.string(),
});

// Schema for a single document
const DocumentSchema = z.object({
  filename: z.string(),
  fullPath: z.string(),
  metadata: DocumentMetadataSchema,
  stats: DocumentStatsSchema,
  content: z.union([FullContentSchema, PreviewContentSchema]),
});

// Schema for AI instructions
const AiInstructionsSchema = z.object({
  purpose: z.string(),
  usage: z.string(),
  content_included: z.boolean(),
});

// Schema for the main successful search result
export const SearchSuccessSchema = z.object({
  query: z.string(),
  found: z.number(),
  total_in_vault: z.number(),
  documents: z.array(DocumentSchema),
  ai_instructions: AiInstructionsSchema,
});

// Schema for when no documents are found
export const SearchNotFoundSchema = z.object({
  query: z.string(),
  found: z.literal(0),
  message: z.string(),
  suggestion: z.string(),
});

// Schema for the quiet mode response
export const SearchQuietSchema = z.object({
    found: z.number(),
    filenames: z.array(z.string()),
});

// Schema for an error response
export const SearchErrorSchema = z.object({
    error: z.string(),
    action: z.string(),
    parameters: z.any(),
});

// Union schema for all possible search results
export const SearchResultSchema = z.union([
  SearchSuccessSchema,
  SearchNotFoundSchema,
  SearchQuietSchema,
  SearchErrorSchema,
]);

// Exporting TypeScript types inferred from schemas
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
export type DocumentStats = z.infer<typeof DocumentStatsSchema>;
export type FullContent = z.infer<typeof FullContentSchema>;
export type PreviewContent = z.infer<typeof PreviewContentSchema>;
export type Document = z.infer<typeof DocumentSchema>;
export type AiInstructions = z.infer<typeof AiInstructionsSchema>;
export type SearchSuccess = z.infer<typeof SearchSuccessSchema>;
export type SearchNotFound = z.infer<typeof SearchNotFoundSchema>;
export type SearchQuiet = z.infer<typeof SearchQuietSchema>;
export type SearchError = z.infer<typeof SearchErrorSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
