import { searchStatusSchema } from "@shared/searchStatus.js";
import { z } from "zod";
import { compressionModeSchema, responseTypeSchema } from "../params.js";

export const collectContextScopeSchema = z.enum(["topic", "all"]);

export const collectContextTokenV1Schema = z.object({
	v: z.literal(1),
	cursor: z.number().int().min(0),
	scope: collectContextScopeSchema,
	topic: z.string().nullable(),
	maxDocs: z.number().int().min(1),
	maxCharsPerDoc: z.number().int().min(200),
});

export const collectContextDocumentSchema = z.object({
	filename: z.string(),
	fullPath: z.string(),
	title: z.string(),
	tags: z.array(z.string()),
	doc_hash: z.string(),
	rank: z
		.number()
		.int()
		.positive()
		.nullable()
		.describe("Position in the search ranking, null if the search missed it"),
	score: z.number().nullable().describe("Score computed by the search"),
	matched_snippets: z
		.array(z.string())
		.describe("Note passages the search matched"),
	excerpt: z.string(),
	stats: z.object({
		contentLength: z.number().int().nonnegative(),
		wordCount: z.number().int().nonnegative(),
		hasContent: z.boolean(),
	}),
	backlinks_count: z.number().int().nonnegative(),
	truncated: z.boolean(),
});

export const collectContextPayloadSchema = z.object({
	action: z.literal("collect_context"),
	scope: collectContextScopeSchema,
	topic: z.string().nullable(),
	matched_total: z.number().int().nonnegative(),
	total_in_vault: z.number().int().nonnegative(),
	documents: z.array(collectContextDocumentSchema),
	cache: z
		.object({
			key: z.string(),
			hit: z.boolean(),
			schema_version: z.string(),
			topic: z.string().nullable(),
			doc_hash: z.string(),
		})
		.optional(),
	batch: z.object({
		start_cursor: z.number().int().nonnegative(),
		processed_docs: z.number().int().nonnegative(),
		consumed_candidates: z.number().int().nonnegative(),
		max_docs: z.number().int().positive(),
		max_chars_per_doc: z.number().int().min(200),
		has_more: z.boolean(),
		continuation_token: z.string().nullable(),
	}),
});

export const collectContextCompressionSchema = z.object({
	mode: compressionModeSchema,
	source_chars: z.number().int().nonnegative(),
	output_chars: z.number().int().nonnegative(),
	estimated_tokens: z.number().int().nonnegative(),
	max_output_chars: z.number().int().positive().nullable(),
	truncated: z.boolean(),
	expand_hint: z.string(),
});

export const collectContextResponseDataSchema =
	collectContextPayloadSchema.extend({
		compression: collectContextCompressionSchema,
		search_status: searchStatusSchema.optional(),
	});

export const collectContextResponseSchema = z.object({
	type: responseTypeSchema,
	text: collectContextResponseDataSchema,
});

export type CollectContextScope = z.infer<typeof collectContextScopeSchema>;
export type CollectContextTokenV1 = z.infer<typeof collectContextTokenV1Schema>;
export type CollectContextDocument = z.infer<
	typeof collectContextDocumentSchema
>;
export type CollectContextPayload = z.infer<typeof collectContextPayloadSchema>;
export type CollectContextResponseData = z.infer<
	typeof collectContextResponseDataSchema
>;
