import { z } from "zod";
import { FrontMatterSchema } from "@/utils/processor/types.js";

const DocumentMetadataSchema = FrontMatterSchema;
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
export const DocumentSchema = z.object({
	filename: z.string(),
	fullPath: z.string(),
	metadata: DocumentMetadataSchema,
	stats: DocumentStatsSchema,
	content: z.union([FullContentSchema, PreviewContentSchema]),
});

// Schema for the main successful search result
export const SearchSuccessSchema = z
	.object({
		query: z
			.string()
			.describe(
				"The search query used for vector DB and inverted index search",
			),
		found: z.number().describe("The number of matching documents found"),
		total_in_vault: z
			.number()
			.describe("The total number of documents in the vault"),
		documents: z
			.array(DocumentSchema)
			.describe("The list of matched documents"),
	})
	.describe(
		"Schema for successful search results. The search process first attempts a semantic vector DB lookup, and falls back to/merges with inverted index search if needed.",
	);

// Schema for when no documents are found
export const SearchNotFoundSchema = z
	.object({
		query: z.string().describe("The search query"),
		found: z.literal(0).describe("The number of matching documents found (0)"),
		message: z.string().describe("No results found message"),
		suggestion: z.string().describe("Suggestions to improve the search"),
	})
	.describe(
		"Schema for search result when no documents are found. Indicates that both vector DB and inverted index searches returned no results.",
	);

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
export const SearchResultSchema = z
	.union([
		SearchSuccessSchema,
		SearchNotFoundSchema,
		SearchQuietSchema,
		SearchErrorSchema,
	])
	.describe(
		"Search result schema. The search process prioritizes vector DB semantic search, falling back to/complementing with the inverted index search when no exact match is found or key details are missing.",
	);

// Exporting TypeScript types inferred from schemas
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
export type DocumentStats = z.infer<typeof DocumentStatsSchema>;
export type FullContent = z.infer<typeof FullContentSchema>;
export type PreviewContent = z.infer<typeof PreviewContentSchema>;
export type Document = z.infer<typeof DocumentSchema>;
export type SearchSuccess = z.infer<typeof SearchSuccessSchema>;
export type SearchNotFound = z.infer<typeof SearchNotFoundSchema>;
export type SearchQuiet = z.infer<typeof SearchQuietSchema>;
export type SearchError = z.infer<typeof SearchErrorSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
