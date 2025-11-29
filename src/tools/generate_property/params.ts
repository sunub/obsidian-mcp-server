import { z } from "zod";

// input properties
const obsidianGenerateInputFilename = z
	.string()
	.describe(
		'The name or path of the file to analyze and add properties to (e.g., "my-first-post.md")',
	);
const obsidianGenerateInputOverwrite = z
	.boolean()
	.default(true)
	.describe(
		"If set to true, existing properties will be overwritten by the AI-generated content. Default: false.",
	);

// input schema
export const obsidianPropertyQueryParamsSchema = z
	.object({
		filename: obsidianGenerateInputFilename,
		overwrite: obsidianGenerateInputOverwrite.optional(),
	})
	.describe(
		"Parameters for generating or updating Obsidian document properties",
	);

export type ObsidianPropertyQueryParams = z.infer<
	typeof obsidianPropertyQueryParamsSchema
>;

// output properties
export const obsidianCssClassesProperty = z
	.array(z.string())
	.describe("List of CSS classes associated with the document");
export const obsidianTagsProperty = z
	.array(z.string())
	.describe("List of tags associated with the document");
export const obsidianTitleProperty = z
	.string()
	.describe("Title of the document");
export const obsidianDateProperty = z
	.string()
	.describe("Creation date of the document in ISO 8601 format");
export const obsidianSummaryProperty = z
	.string()
	.describe("Brief summary or abstract of the document");
export const obsidianSlugProperty = z
	.string()
	.describe("URL-friendly identifier for the document");
export const obsidianCategoryProperty = z
	.string()
	.describe("Category or classification of the document");
export const obsidianCompletedProperty = z
	.boolean()
	.describe("Indicates whether a task or item is completed");

// output schema
export const obsidianPropertyOutputSchema = z
	.object({
		cssclasses: obsidianCssClassesProperty.optional(),
		tags: obsidianTagsProperty.optional(),
		title: obsidianTitleProperty.optional(),
		date: obsidianDateProperty.optional(),
		summary: obsidianSummaryProperty.optional(),
		slug: obsidianSlugProperty.optional(),
		category: obsidianCategoryProperty.optional(),
		completed: obsidianCompletedProperty.optional(),
	})
	.describe("Extracted properties from the Obsidian document content");
