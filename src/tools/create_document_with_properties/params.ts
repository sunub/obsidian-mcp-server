import { z } from 'zod';
import { obsidianPropertyOutputSchema } from '../generate_obsidian_property/params.js';

// input properties
const sourcePath = z.string().describe('The path to the source markdown file to read and analyze (e.g., "draft/my-article.md")');
const outputPath = z.string().optional().describe('The path where the processed file with properties will be saved. If not provided, the source file will be updated in place.');
const overwrite = z.boolean().default(false).describe('If set to true, existing properties will be overwritten by the AI-generated content. Default: false.');
const aiGeneratedProperties = obsidianPropertyOutputSchema.optional().describe('AI-generated properties based on content analysis. If provided, these will be used instead of internal analysis.');
const quiet = z.boolean().optional().default(false).describe('If true, the final write operation will return a minimal success message.');

// input schema
export const createDocumentWithPropertiesParamsSchema = z.object({
  sourcePath: sourcePath,
  outputPath: outputPath,
  overwrite: overwrite.optional(),
  aiGeneratedProperties: aiGeneratedProperties.optional(),
  quiet: quiet
}).describe('Parameters for creating or updating a document with automatically generated properties');

export type CreateDocumentWithPropertiesParams = z.infer<typeof createDocumentWithPropertiesParamsSchema>;
