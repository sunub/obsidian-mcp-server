import { z } from "zod";

export const responseTypeSchema = z
	.enum(["text", "audio", "image", "resource", "resource_link"])
	.describe("The type of content being returned");

export const compressionModeSchema = z
	.enum(["summary", "aggressive", "balanced", "none"])
	.default("summary")
	.describe(
		"Compression strategy for tool output. summary: lightest TOC & document summary only (default), aggressive: smallest output, balanced: moderate size, none: keep as much original content as possible.",
	);

const maxOutputCharsSchema = z
	.number()
	.min(500)
	.max(12000)
	.describe(
		"Optional hard cap for output size in characters. Helps control token cost in long responses.",
	);

const quietMode = z
	.boolean()
	.default(true)
	.describe("If true, suppresses non-error output messages. Default is false.");

export const obsidianContentActions = z
	.enum(["search", "read", "list_all", "stats"])
	.describe(
		"The action to perform: search documents, read specific file, list all content, or get stats",
	);
export const obsidianContentKeyword = z
	.string()
	.describe("Keyword to search for in documents (required for search action)");
export const obsidianContentFilename = z
	.string()
	.describe("Specific filename to read (required for read action)");
export const obsidianContentLimit = z
	.number()
	.min(1)
	.max(100)
	.describe(
		"Maximum number of results to return (default: 10 for search, unlimited for others)",
	);
export const obsidianContentIncludeContent = z
	.boolean()
	.default(true)
	.describe(
		"Whether to include document content in search results (default: true)",
	);
export const obsidianContentIncludeFrontmatter = z
	.boolean()
	.default(false)
	.describe(
		"Whether to include frontmatter metadata in results (default: false)",
	);
export const obsidianContentExcerptLength = z
	.number()
	.min(100)
	.max(2000)
	.default(500)
	.describe(
		"Length of content excerpt to include in search results (default: 500)",
	);
export const obsidianContentQueryParamsZod = z
	.object({
		action: obsidianContentActions,
		keyword: obsidianContentKeyword.optional(),
		filename: obsidianContentFilename.optional(),
		limit: obsidianContentLimit.optional(),
		includeContent: obsidianContentIncludeContent.optional(),
		includeFrontmatter: obsidianContentIncludeFrontmatter.optional(),
		excerptLength: obsidianContentExcerptLength.optional(),
		compressionMode: compressionModeSchema.optional(),
		maxOutputChars: maxOutputCharsSchema.optional(),
		quiet: quietMode.optional(),
	})
	.strict();

export type ObsidianContentQueryParams = z.infer<
	typeof obsidianContentQueryParamsZod
>;

export const aiInstructionsSchema = z
	.object({
		purpose: z
			.string()
			.describe("The purpose of providing this content to the AI"),
		usage: z.string().describe("How the AI should use this content"),
		content_type: z
			.string()
			.describe("The format of the content, e.g., markdown"),
	})
	.describe("Instructions for AI on how to process the document content");

export const metadataSchema = z
	.object({
		fullPath: z.string().describe("The full path to the file in the vault"),
		title: z
			.string()
			.nullable()
			.describe("The title of the document, if available"),
		tags: z
			.array(z.string())
			.describe("List of tags associated with the document"),
		category: z.string().describe("Category of the document, if available"),
		date: z
			.string()
			.nullable()
			.describe(
				"Creation date of the document in ISO 8601 format, if available",
			),
		summary: z
			.string()
			.nullable()
			.describe("Brief summary or abstract of the document, if available"),
		completed: z
			.boolean()
			.describe("Indicates whether a task or item is completed"),
	})
	.describe("Metadata extracted from the document frontmatter, if available");
