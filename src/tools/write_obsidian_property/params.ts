import { z } from 'zod';

// input properties
const obsidianCssClassesProperty = z.array(z.string()).describe('List of CSS classes associated with the document');
const obsidianTagsProperty = z.array(z.string()).describe('List of tags associated with the document');
const obsidianTitleProperty = z.string().describe('Title of the document');
const obsidianDateProperty = z.string().describe('Creation date of the document in ISO 8601 format');
const obsidianSummaryProperty = z.string().describe('Brief summary or abstract of the document');
const obsidianSlugProperty = z.string().describe('URL-friendly identifier for the document');
const obsidianCategoryProperty = z.string().describe('Category or classification of the document');
const obsidianCompletedProperty = z.boolean().describe('Indicates whether a task or item is completed');
const quiteMode = z.boolean().default(true).describe('If true, suppresses non-error output messages. Default is false.');

const obsidianPropertySchema = z.object({
  cssclasses: obsidianCssClassesProperty.optional(),
  tags: obsidianTagsProperty.optional(),
  title: obsidianTitleProperty.optional(),
  date: obsidianDateProperty.optional(),
  summary: obsidianSummaryProperty.optional(),
  slug: obsidianSlugProperty.optional(),
  category: obsidianCategoryProperty.optional(),
  completed: obsidianCompletedProperty.optional(),
}).describe('Schema for Obsidian frontmatter properties');

// input schema
export const obsidianPropertyParamsSchema = z.object({
  filePath: z.string().min(1).describe('Path to the target markdown file within the Obsidian vault'),
  properties: obsidianPropertySchema.describe('Key-value pairs to be written to the file\'s frontmatter'),
  quiet: quiteMode.optional(),
}).describe('Parameters for writing properties to an Obsidian markdown file');

export type ObsidianPropertyParams = z.infer<typeof obsidianPropertyParamsSchema>;
