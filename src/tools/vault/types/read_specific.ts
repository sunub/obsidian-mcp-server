import { z } from "zod";
import { FrontMatterSchema } from "@/utils/processor/types.js";
import { metadataSchema, responseTypeSchema } from "../params.js";

const statsSchema = z.object({
  wordCount: z.number().describe('Total number of words in the content'),
  lineCount: z.number().describe('Total number of lines in the content'),
  contentLength: z.number().describe('Total number of characters in the content from index'),
  hasContent: z.boolean().describe('Whether the document has any content'),
  characterCount: z.number().describe('Total number of characters in the content'),
}).describe('Basic statistics about the document content');

const backlinkSchema = z.object({
  filePath: z.string(),
  title: z.string(),
});

export const readSpecificFileDocumentData = z.object({
  filePath: z.string().describe('The full path to the file'),
  filename: z.string().describe('The name of the file that was read').optional(), // filename은 이제 최상위가 아닐 수 있음
  frontmatter: FrontMatterSchema.describe('The frontmatter metadata of the file'),
  contentLength: z.number(),
  imageLinks: z.array(z.string()),
  documentLinks: z.array(z.string()),
  content: z.string().describe('The full text content of the file'),
  stats: statsSchema,
  backlinks: z.array(backlinkSchema).optional(),
}).describe('Response schema for reading a specific file from the Obsidian vault');

export const readSpecificFileResponseSchema = z.object({
  type: responseTypeSchema,
  text : readSpecificFileDocumentData,
});

export type ReadSpecificFileResponse = z.infer<typeof readSpecificFileResponseSchema>;
