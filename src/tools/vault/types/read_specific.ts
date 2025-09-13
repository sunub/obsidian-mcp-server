import { z } from "zod";
import { metadataSchema, aiInstructionsSchema, responseTypeSchema } from "../params.js";

const statsSchema = z.object({
  contentLength: z.number().describe('Total number of characters in the content'),
  wordCount: z.number().describe('Total number of words in the content'),
  lineCount: z.number().describe('Total number of lines in the content')
}).describe('Basic statistics about the document content');

// read specific file response schema
export const readSpecificFileDocumentData = z.object({
  filename: z.string().describe('The name of the file that was read'),
  content: z.string().describe('The full text content of the file'),
  metadata: metadataSchema.nullable(),
  stats: statsSchema,
  ai_instructions: aiInstructionsSchema.optional()
}).describe('Response schema for reading a specific file from the Obsidian vault');

export const readSpecificFileResponseSchema = z.object({
  type: responseTypeSchema,
  text : readSpecificFileDocumentData,
});

export type ReadSpecificFileResponse = z.infer<typeof readSpecificFileResponseSchema>;
