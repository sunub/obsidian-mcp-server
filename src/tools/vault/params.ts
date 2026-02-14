import { z } from "zod";

export const responseTypeSchema = z
	.enum(["text", "audio", "image", "resource", "resource_link"])
	.describe("The type of content being returned");

export const compressionModeSchema = z
	.enum(["aggressive", "balanced", "none"])
	.default("balanced")
	.describe(
		"Compression strategy for tool output. aggressive: smallest output, balanced: default, none: keep as much original content as possible.",
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

// input properties schema
export const obsidianContentActions = z
	.enum([
		"search",
		"read",
		"list_all",
		"stats",
		"collect_context",
		"load_memory",
	])
	.describe(
		"The action to perform: search documents, read specific file, list all content, get stats, collect contextual memory packets, or load stored memory",
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
export const obsidianContentTopic = z
	.string()
	.min(1)
	.describe("Topic to collect contextual memory for (collect_context action)");
export const obsidianContentScope = z
	.enum(["topic", "all"])
	.default("topic")
	.describe(
		"Scope for collect_context. topic: collect docs relevant to topic, all: collect from the entire vault.",
	);
export const obsidianContentMaxDocs = z
	.number()
	.int()
	.min(1)
	.max(100)
	.default(20)
	.describe("Maximum number of documents to process for collect_context");
export const obsidianContentMaxCharsPerDoc = z
	.number()
	.int()
	.min(200)
	.max(8000)
	.default(1800)
	.describe(
		"Maximum number of characters extracted per document for collect_context",
	);
export const obsidianContentMemoryMode = z
	.enum(["response_only", "vault_note", "both"])
	.default("response_only")
	.describe(
		"Memory output mode for collect_context. response_only: return packet only, vault_note: save to vault note only, both: return and save.",
	);
export const obsidianContentContinuationToken = z
	.string()
	.min(1)
	.describe(
		"Continuation token to resume a previous collect_context batch operation",
	);
export const obsidianContentMemoryPath = z
	.string()
	.describe(
		"Path to a stored memory note for load_memory (default: memory/context_memory_snapshot.v1.md)",
	);

// input schema
export const obsidianContentQueryParamsZod = z.object({
	action: obsidianContentActions,
	keyword: obsidianContentKeyword.optional(),
	filename: obsidianContentFilename.optional(),
	limit: obsidianContentLimit.optional(),
	includeContent: obsidianContentIncludeContent.optional(),
	includeFrontmatter: obsidianContentIncludeFrontmatter.optional(),
	excerptLength: obsidianContentExcerptLength.optional(),
	topic: obsidianContentTopic.optional(),
	scope: obsidianContentScope.optional(),
	maxDocs: obsidianContentMaxDocs.optional(),
	maxCharsPerDoc: obsidianContentMaxCharsPerDoc.optional(),
	memoryMode: obsidianContentMemoryMode.optional(),
	continuationToken: obsidianContentContinuationToken.optional(),
	memoryPath: obsidianContentMemoryPath.optional(),
	compressionMode: compressionModeSchema.optional(),
	maxOutputChars: maxOutputCharsSchema.optional(),
	quiet: quietMode.optional(),
});

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
