import { createHash } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SearchStatus } from "@shared/searchStatus.js";
import { createToolError } from "@/utils/createToolError.js";
import type { EnrichedDocument } from "../../../../utils/VaultManger/types.js";
import type {
	HybridSearchResult,
	VaultManager,
} from "../../../../utils/VaultManger/VaultManager.js";
import type { ObsidianContentQueryParams } from "../../params.js";
import {
	type CollectContextDocument,
	type CollectContextPayload,
	type CollectContextScope,
	type CollectContextTokenV1,
	collectContextPayloadSchema,
	collectContextResponseDataSchema,
	collectContextTokenV1Schema,
} from "../../types/collect_context.js";
import { COLLECT_CONTEXT_CACHE_SCHEMA_VERSION } from "../constants.js";
import {
	ACTION_DEFAULT_MAX_OUTPUT_CHARS,
	finalizePayloadWithCompression,
	jsonCharLength,
	normalizeWhitespace,
	resolveCompressionMode,
	stripFrontmatterBlock,
	trimWithEllipsis,
} from "../shared.js";

const COLLECT_CONTEXT_CACHE_MAX_ENTRIES = 200;
const COLLECT_CONTEXT_CANDIDATE_LIMIT = 100;
const COLLECT_CONTEXT_MIN_EXCERPT_CHARS = 220;
const COLLECT_CONTEXT_MIN_SNIPPET_CHARS = 80;
const COLLECT_CONTEXT_MAX_SNIPPETS = 2;
const COLLECT_CONTEXT_SNIPPET_CHARS = 220;

type CollectContextCacheEntry = {
	key: string;
	payload: CollectContextPayload;
	createdAt: number;
};

const collectContextCache = new Map<string, CollectContextCacheEntry>();

type SearchEvidence = Pick<
	CollectContextDocument,
	"rank" | "score" | "matched_snippets"
>;

const NOT_MATCHED: SearchEvidence = {
	rank: null,
	score: null,
	matched_snippets: [],
};

function toSearchEvidence(
	result: HybridSearchResult,
	index: number,
): SearchEvidence {
	return {
		rank: index + 1,
		score: result.finalScore,
		matched_snippets: result.matchedChunks
			.slice(0, COLLECT_CONTEXT_MAX_SNIPPETS)
			.map((chunk) =>
				trimWithEllipsis(
					normalizeWhitespace(chunk.content),
					COLLECT_CONTEXT_SNIPPET_CHARS,
				),
			),
	};
}

function buildCollectContextDocument(
	doc: EnrichedDocument,
	maxCharsPerDoc: number,
	evidence: SearchEvidence,
): CollectContextDocument {
	const filename = doc.filePath.split("/").pop() || doc.filePath;
	const title = doc.frontmatter.title || filename.replace(/\.mdx?$/i, "");
	const tags = Array.isArray(doc.frontmatter.tags)
		? doc.frontmatter.tags.filter(
				(tag): tag is string => typeof tag === "string",
			)
		: [];
	const sourceContent = stripFrontmatterBlock(doc.content);
	const excerpt = trimWithEllipsis(
		normalizeWhitespace(sourceContent),
		maxCharsPerDoc,
	);
	const sourceContentLength = doc.stats?.contentLength ?? sourceContent.length;
	const stats = {
		contentLength: sourceContentLength,
		wordCount: doc.stats?.wordCount ?? 0,
		hasContent: doc.stats?.hasContent ?? sourceContent.trim().length > 0,
	};
	const docHash =
		doc.contentHash ??
		createHash("sha256").update(sourceContent, "utf8").digest("hex");

	return {
		filename,
		fullPath: doc.filePath,
		title,
		tags,
		doc_hash: docHash,
		...evidence,
		excerpt,
		stats,
		backlinks_count: doc.backlinks?.length ?? 0,
		truncated: sourceContentLength > excerpt.length,
	};
}

function buildCollectContextPayload(params: {
	scope: CollectContextScope;
	topic: string | null;
	matchedTotal: number;
	totalInVault: number;
	documents: CollectContextDocument[];
	cache?: {
		key: string;
		hit: boolean;
		schema_version: string;
		topic: string | null;
		doc_hash: string;
	};
	startCursor: number;
	processedDocs: number;
	consumedCandidates: number;
	maxDocs: number;
	maxCharsPerDoc: number;
	hasMore: boolean;
	continuationToken: string | null;
}): CollectContextPayload {
	return collectContextPayloadSchema.parse({
		action: "collect_context",
		scope: params.scope,
		topic: params.topic,
		matched_total: params.matchedTotal,
		total_in_vault: params.totalInVault,
		documents: params.documents,
		cache: params.cache,
		batch: {
			start_cursor: params.startCursor,
			processed_docs: params.processedDocs,
			consumed_candidates: params.consumedCandidates,
			max_docs: params.maxDocs,
			max_chars_per_doc: params.maxCharsPerDoc,
			has_more: params.hasMore,
			continuation_token: params.continuationToken,
		},
	});
}

function reduceCollectContextBacklinksForBudget(
	documents: CollectContextDocument[],
): boolean {
	let changed = false;

	for (const doc of documents) {
		if (doc.backlinks_count <= 0) {
			continue;
		}

		let nextCount = doc.backlinks_count;
		if (doc.backlinks_count > 10) {
			nextCount = 10;
		} else if (doc.backlinks_count > 5) {
			nextCount = 5;
		} else if (doc.backlinks_count > 3) {
			nextCount = 3;
		} else {
			nextCount = 0;
		}

		if (nextCount !== doc.backlinks_count) {
			doc.backlinks_count = nextCount;
			changed = true;
		}
	}

	return changed;
}

function reduceCollectContextPerDocCharsForBudget(
	documents: CollectContextDocument[],
): boolean {
	let changed = false;

	for (const doc of documents) {
		if (doc.excerpt.length > COLLECT_CONTEXT_MIN_EXCERPT_CHARS) {
			const nextLength = Math.max(
				COLLECT_CONTEXT_MIN_EXCERPT_CHARS,
				Math.floor(doc.excerpt.length * 0.8),
			);
			const nextExcerpt = trimWithEllipsis(doc.excerpt, nextLength);
			if (nextExcerpt !== doc.excerpt) {
				doc.excerpt = nextExcerpt;
				doc.truncated = true;
				changed = true;
			}
		}

		const nextSnippets = doc.matched_snippets.map((snippet) => {
			if (snippet.length <= COLLECT_CONTEXT_MIN_SNIPPET_CHARS) {
				return snippet;
			}
			const nextLength = Math.max(
				COLLECT_CONTEXT_MIN_SNIPPET_CHARS,
				Math.floor(snippet.length * 0.8),
			);
			return trimWithEllipsis(snippet, nextLength);
		});

		if (JSON.stringify(nextSnippets) !== JSON.stringify(doc.matched_snippets)) {
			doc.matched_snippets = nextSnippets;
			doc.truncated = true;
			changed = true;
		}
	}

	return changed;
}

function buildCollectContextDocHash(
	documents: CollectContextDocument[],
): string {
	return createHash("sha256")
		.update(
			JSON.stringify(
				documents.map((doc) => ({
					fullPath: doc.fullPath,
					doc_hash: doc.doc_hash,
					rank: doc.rank,
					score: doc.score,
					matched_snippets: doc.matched_snippets,
				})),
			),
			"utf8",
		)
		.digest("hex");
}

function buildCollectContextCacheKey(params: {
	scope: CollectContextScope;
	topic: string | null;
	docHash: string;
	startCursor: number;
	maxDocs: number;
	maxCharsPerDoc: number;
}): string {
	return JSON.stringify({
		scope: params.scope,
		topic: params.topic,
		doc_hash: params.docHash,
		schema_version: COLLECT_CONTEXT_CACHE_SCHEMA_VERSION,
		start_cursor: params.startCursor,
		max_docs: params.maxDocs,
		max_chars_per_doc: params.maxCharsPerDoc,
	});
}

function getCollectContextCache(key: string): CollectContextPayload | null {
	const entry = collectContextCache.get(key);
	if (!entry) {
		return null;
	}
	entry.createdAt = Date.now();
	return structuredClone(entry.payload);
}

function setCollectContextCache(
	key: string,
	payload: CollectContextPayload,
): CollectContextPayload {
	const cachedPayload = structuredClone(payload);
	collectContextCache.set(key, {
		key,
		payload: cachedPayload,
		createdAt: Date.now(),
	});

	if (collectContextCache.size > COLLECT_CONTEXT_CACHE_MAX_ENTRIES) {
		const oldest = [...collectContextCache.values()].sort(
			(a, b) => a.createdAt - b.createdAt,
		)[0];
		if (oldest) {
			collectContextCache.delete(oldest.key);
		}
	}

	return structuredClone(cachedPayload);
}

function trimCollectContextPayloadToOutputLimit(
	payload: CollectContextPayload,
	maxOutputChars: number,
): { payload: CollectContextPayload; clamped: boolean } {
	const next = structuredClone(payload);
	let clamped = false;
	let droppedDocCount = 0;

	if (
		jsonCharLength(next) > maxOutputChars &&
		reduceCollectContextBacklinksForBudget(next.documents)
	) {
		clamped = true;
	}

	while (jsonCharLength(next) > maxOutputChars) {
		const reduced = reduceCollectContextPerDocCharsForBudget(next.documents);
		if (!reduced) {
			break;
		}
		clamped = true;
	}

	while (jsonCharLength(next) > maxOutputChars && next.documents.length > 1) {
		next.documents.pop();
		droppedDocCount++;
		clamped = true;
	}

	if (droppedDocCount > 0) {
		next.batch.processed_docs = next.documents.length;
		next.batch.consumed_candidates = Math.max(
			0,
			next.batch.consumed_candidates - droppedDocCount,
		);
		const continuationCursor =
			next.batch.start_cursor + next.batch.consumed_candidates;
		next.batch.has_more = true;
		next.batch.continuation_token = encodeCollectContextContinuationToken({
			v: 1,
			cursor: continuationCursor,
			scope: next.scope,
			topic: next.topic,
			maxDocs: next.batch.max_docs,
			maxCharsPerDoc: next.batch.max_chars_per_doc,
		});
	}

	return { payload: next, clamped };
}

function encodeCollectContextContinuationToken(
	token: CollectContextTokenV1,
): string {
	return Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
}

function decodeCollectContextContinuationToken(
	rawToken: string,
): CollectContextTokenV1 | null {
	try {
		const parsed = JSON.parse(
			Buffer.from(rawToken, "base64url").toString("utf8"),
		);
		const validation = collectContextTokenV1Schema.safeParse(parsed);
		if (!validation.success) {
			return null;
		}

		return {
			v: 1,
			cursor: Math.floor(validation.data.cursor),
			scope: validation.data.scope,
			topic: validation.data.topic,
			maxDocs: Math.floor(validation.data.maxDocs),
			maxCharsPerDoc: Math.floor(validation.data.maxCharsPerDoc),
		};
	} catch {
		return null;
	}
}

function buildCollectContextToolResult(
	payload: unknown,
	searchStatus: SearchStatus | undefined,
): CallToolResult {
	const data = collectContextResponseDataSchema.parse({
		...(payload as object),
		search_status: searchStatus,
	});
	return {
		isError: false,
		content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
	};
}

export async function collectContext(
	vaultManager: VaultManager,
	params: ObsidianContentQueryParams,
): Promise<CallToolResult> {
	await vaultManager.initialize();
	const mode = resolveCompressionMode(params);
	const continuation = params.continuationToken
		? decodeCollectContextContinuationToken(params.continuationToken)
		: null;

	if (params.continuationToken && !continuation) {
		return createToolError(
			"Invalid continuationToken for collect_context action",
			"Use the continuation_token value returned by a previous collect_context call.",
		);
	}

	const scope: CollectContextScope =
		continuation?.scope ?? params.scope ?? "topic";
	const topic =
		continuation?.topic ?? (params.topic?.trim() ? params.topic.trim() : null);
	const maxDocs = continuation?.maxDocs ?? params.maxDocs ?? 20;
	const maxCharsPerDoc =
		continuation?.maxCharsPerDoc ?? params.maxCharsPerDoc ?? 1800;
	const startCursor = continuation?.cursor ?? 0;

	if (scope === "topic" && !topic) {
		return createToolError(
			"topic parameter is required for collect_context when scope='topic'",
			'Provide a topic, e.g. { action: "collect_context", topic: "next.js", scope: "topic" }',
		);
	}

	const allDocuments = await vaultManager.getAllDocuments();
	const { results: rankedResults, search_status: searchStatus } = topic
		? await vaultManager.hybridSearch(topic, COLLECT_CONTEXT_CANDIDATE_LIMIT)
		: { results: [], search_status: undefined };
	const rankedCandidates = rankedResults.map((result) => result.document);
	const evidenceByPath = new Map(
		rankedResults.map((result, index) => [
			result.document.filePath,
			toSearchEvidence(result, index),
		]),
	);
	const orderedCandidates =
		scope === "all"
			? [
					...rankedCandidates,
					...allDocuments
						.filter((doc) => !evidenceByPath.has(doc.filePath))
						.sort((a, b) => a.filePath.localeCompare(b.filePath)),
				]
			: rankedCandidates;

	const emptyDocHash = buildCollectContextDocHash([]);
	const emptyCacheKey = buildCollectContextCacheKey({
		scope,
		topic,
		docHash: emptyDocHash,
		startCursor,
		maxDocs,
		maxCharsPerDoc,
	});

	if (
		orderedCandidates.length === 0 ||
		startCursor >= orderedCandidates.length
	) {
		const cachedEmptyPayload = getCollectContextCache(emptyCacheKey);
		const emptyCacheHit = cachedEmptyPayload !== null;
		let emptyPayload =
			cachedEmptyPayload ??
			setCollectContextCache(
				emptyCacheKey,
				buildCollectContextPayload({
					scope,
					topic,
					matchedTotal: orderedCandidates.length,
					totalInVault: allDocuments.length,
					documents: [],
					cache: {
						key: emptyCacheKey,
						hit: false,
						schema_version: COLLECT_CONTEXT_CACHE_SCHEMA_VERSION,
						topic,
						doc_hash: emptyDocHash,
					},
					startCursor,
					processedDocs: 0,
					consumedCandidates: 0,
					maxDocs,
					maxCharsPerDoc,
					hasMore: false,
					continuationToken: null,
				}),
			);

		if (emptyCacheHit && emptyPayload.cache) {
			emptyPayload = collectContextPayloadSchema.parse({
				...emptyPayload,
				cache: {
					...emptyPayload.cache,
					hit: true,
				},
			});
		}

		const finalizedPayload = collectContextResponseDataSchema.parse(
			finalizePayloadWithCompression(emptyPayload, {
				mode,
				source_chars: 0,
				max_output_chars:
					params.maxOutputChars ??
					(mode === "none"
						? null
						: ACTION_DEFAULT_MAX_OUTPUT_CHARS.collect_context[mode]),
				truncated: false,
				expand_hint:
					"If more context is needed, rerun collect_context with broader scope or topic.",
			}),
		);

		return buildCollectContextToolResult(finalizedPayload, searchStatus);
	}

	const maxOutputChars =
		params.maxOutputChars ??
		(mode === "none"
			? null
			: ACTION_DEFAULT_MAX_OUTPUT_CHARS.collect_context[mode]);

	const documents: CollectContextDocument[] = [];
	let sourceChars = 0;
	let consumedCandidates = 0;
	let outputCapClamped = false;
	let scannedIndex = startCursor;

	while (
		scannedIndex < orderedCandidates.length &&
		documents.length < maxDocs
	) {
		const candidate = orderedCandidates[scannedIndex];
		scannedIndex++;
		consumedCandidates++;

		const enrichedDoc = await vaultManager.getDocumentInfo(candidate.filePath, {
			includeStats: true,
			includeBacklinks: true,
			includeContentHash: true,
			maxContentPreview: maxCharsPerDoc,
		});

		if (!enrichedDoc) {
			continue;
		}

		const nextDoc = buildCollectContextDocument(
			enrichedDoc,
			maxCharsPerDoc,
			evidenceByPath.get(candidate.filePath) ?? NOT_MATCHED,
		);
		documents.push(nextDoc);
		sourceChars += nextDoc.stats.contentLength;

		if (typeof maxOutputChars === "number") {
			const buildProvisionalPayload = () =>
				buildCollectContextPayload({
					scope,
					topic,
					matchedTotal: orderedCandidates.length,
					totalInVault: allDocuments.length,
					documents,
					startCursor,
					processedDocs: documents.length,
					consumedCandidates,
					maxDocs,
					maxCharsPerDoc,
					hasMore: scannedIndex < orderedCandidates.length,
					continuationToken: null,
				});

			let provisionalPayload = buildProvisionalPayload();
			if (jsonCharLength(provisionalPayload) > maxOutputChars) {
				outputCapClamped = true;

				if (reduceCollectContextBacklinksForBudget(documents)) {
					provisionalPayload = buildProvisionalPayload();
				}

				while (jsonCharLength(provisionalPayload) > maxOutputChars) {
					const reduced = reduceCollectContextPerDocCharsForBudget(documents);
					if (!reduced) {
						break;
					}
					provisionalPayload = buildProvisionalPayload();
				}

				if (jsonCharLength(provisionalPayload) > maxOutputChars) {
					if (documents.length > 1) {
						const removedDoc = documents.pop();
						if (removedDoc) {
							sourceChars -= removedDoc.stats.contentLength;
						}
						consumedCandidates--;
						scannedIndex--;
					}

					break;
				}
			}
		}
	}

	const nextCursor = startCursor + consumedCandidates;
	const hasMore = nextCursor < orderedCandidates.length;
	const continuationToken = hasMore
		? encodeCollectContextContinuationToken({
				v: 1,
				cursor: nextCursor,
				scope,
				topic,
				maxDocs,
				maxCharsPerDoc,
			})
		: null;

	const docHash = buildCollectContextDocHash(documents);
	const cacheKey = buildCollectContextCacheKey({
		scope,
		topic,
		docHash: docHash,
		startCursor,
		maxDocs,
		maxCharsPerDoc,
	});
	const cachedPayload = getCollectContextCache(cacheKey);
	const cacheHit = cachedPayload !== null;

	const basePayload =
		cachedPayload ??
		setCollectContextCache(
			cacheKey,
			buildCollectContextPayload({
				scope,
				topic,
				matchedTotal: orderedCandidates.length,
				totalInVault: allDocuments.length,
				documents,
				cache: {
					key: cacheKey,
					hit: false,
					schema_version: COLLECT_CONTEXT_CACHE_SCHEMA_VERSION,
					topic,
					doc_hash: docHash,
				},
				startCursor,
				processedDocs: documents.length,
				consumedCandidates,
				maxDocs,
				maxCharsPerDoc,
				hasMore,
				continuationToken,
			}),
		);

	let payloadForCompression = cacheHit
		? collectContextPayloadSchema.parse({
				...basePayload,
				cache: basePayload.cache
					? {
							...basePayload.cache,
							hit: true,
						}
					: {
							key: cacheKey,
							hit: true,
							schema_version: COLLECT_CONTEXT_CACHE_SCHEMA_VERSION,
							topic,
							doc_hash: docHash,
						},
			})
		: basePayload;

	if (typeof maxOutputChars === "number") {
		const trimmed = trimCollectContextPayloadToOutputLimit(
			payloadForCompression,
			maxOutputChars - jsonCharLength({ search_status: searchStatus }),
		);
		payloadForCompression = trimmed.payload;
		outputCapClamped = outputCapClamped || trimmed.clamped;
	}

	const finalizedPayload = collectContextResponseDataSchema.parse(
		finalizePayloadWithCompression(payloadForCompression, {
			mode,
			source_chars: sourceChars,
			max_output_chars: maxOutputChars,
			truncated:
				hasMore || documents.some((doc) => doc.truncated) || outputCapClamped,
			expand_hint:
				"If has_more is true, call collect_context again with continuationToken.",
		}),
	);

	return buildCollectContextToolResult(finalizedPayload, searchStatus);
}
