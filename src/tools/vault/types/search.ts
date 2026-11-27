import { searchStatusSchema } from "@shared/searchStatus.js";
import { z } from "zod";

export const DocumentSchema = z.object({
	path: z.string(),
	title: z.string().optional(),
	tags: z.array(z.string()),
	snippet: z.string().max(200).optional(),
});

export const SearchSuccessSchema = z
	.object({
		query: z
			.string()
			.describe(
				"The search query used for vector DB and inverted index search",
			),
		search_status: searchStatusSchema,
		found: z.number().describe("The number of returned documents"),
		documents: z
			.array(DocumentSchema)
			.describe("The matched documents, best match first"),
		hint: z.string().optional().describe("How to read a returned document"),
	})
	.describe(
		"Schema for successful search results. The search process first attempts a semantic vector DB lookup, and falls back to/merges with inverted index search if needed.",
	);

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

export const SearchQuietSchema = z.object({
	found: z.number(),
	search_status: searchStatusSchema,
	filenames: z.array(z.string()),
});

export const SearchErrorSchema = z.object({
	error: z.string(),
	action: z.string(),
	parameters: z.any(),
});

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

export type Document = z.infer<typeof DocumentSchema>;
export type SearchSuccess = z.infer<typeof SearchSuccessSchema>;
export type SearchNotFound = z.infer<typeof SearchNotFoundSchema>;
export type SearchQuiet = z.infer<typeof SearchQuietSchema>;
export type SearchError = z.infer<typeof SearchErrorSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
