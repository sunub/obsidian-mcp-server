import { createHash } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createToolError } from "@/utils/createToolError.js";
import type { EnrichedDocument } from "../../../../utils/VaultManger/types.js";
import type { VaultManager } from "../../../../utils/VaultManger/VaultManager.js";
import type { ObsidianContentQueryParams } from "../../params.js";
import {
	type CollectContextDocument,
	type CollectContextMemoryMode,
	type CollectContextMemoryPacket,
	type CollectContextPayload,
	type CollectContextRelevance,
	type CollectContextScope,
	type CollectContextTokenV1,
	collectContextMemoryPacketSchema,
	collectContextPayloadSchema,
	collectContextResponseDataSchema,
	collectContextTokenV1Schema,
} from "../../types/collect_context.js";
import {
	CONTEXT_MEMORY_SNAPSHOT_NOTE_PATH,
	CONTEXT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
} from "../constants.js";
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
const COLLECT_CONTEXT_MIN_EXCERPT_CHARS = 220;
const COLLECT_CONTEXT_MIN_SUMMARY_CHARS = 120;
const COLLECT_CONTEXT_MIN_EVIDENCE_CHARS = 80;

type CollectContextCacheEntry = {
	key: string;
	payload: CollectContextPayload;
	createdAt: number;
};

const collectContextCache = new Map<string, CollectContextCacheEntry>();

function pickEvidenceSnippets(content: string, maxSnippets: number): string[] {
	const lines = stripFrontmatterBlock(content)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length >= 24);

	const prioritized = [
		...lines.filter((line) => /^([-*]|\d+[.)])\s+/.test(line)),
		...lines.filter((line) => /^#{1,6}\s+/.test(line)),
		...lines.filter(
			(line) => !/^([-*]|\d+[.)])\s+/.test(line) && !/^#{1,6}\s+/.test(line),
		),
	];

	const unique = [...new Set(prioritized)].map((line) =>
		normalizeWhitespace(line.replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "")),
	);

	return unique
		.slice(0, maxSnippets)
		.map((line) => trimWithEllipsis(line, 220));
}

function inferCollectContextRelevance(
	doc: Pick<CollectContextDocument, "title" | "tags" | "excerpt">,
	topic: string | null,
): CollectContextRelevance {
	if (!topic) {
		return "medium";
	}
	const normalizedTopic = topic.toLowerCase();
	if (
		doc.title.toLowerCase().includes(normalizedTopic) ||
		doc.tags.some((tag) => tag.toLowerCase().includes(normalizedTopic))
	) {
		return "high";
	}
	if (doc.excerpt.toLowerCase().includes(normalizedTopic)) {
		return "medium";
	}
	return "low";
}

function buildCollectContextDocument(
	doc: EnrichedDocument,
	maxCharsPerDoc: number,
	topic: string | null,
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
	const evidenceSnippets = pickEvidenceSnippets(sourceContent, 2);
	const summary =
		evidenceSnippets.join(" ").trim() ||
		trimWithEllipsis(excerpt, 220) ||
		title;
	const sourceContentLength = doc.stats?.contentLength ?? sourceContent.length;
	const stats = {
		contentLength: sourceContentLength,
		wordCount: doc.stats?.wordCount ?? 0,
		hasContent: doc.stats?.hasContent ?? sourceContent.trim().length > 0,
	};
	const docHash =
		doc.contentHash ??
		createHash("sha256").update(sourceContent, "utf8").digest("hex");

	const relevance = inferCollectContextRelevance(
		{
			title,
			tags,
			excerpt,
		},
		topic,
	);

	return {
		filename,
		fullPath: doc.filePath,
		title,
		tags,
		doc_hash: docHash,
		summary,
		excerpt,
		evidence_snippets: evidenceSnippets,
		relevance,
		stats,
		backlinks_count: doc.backlinks?.length ?? 0,
		truncated: sourceContentLength > excerpt.length,
	};
}

function buildCollectContextMemoryPacket(
	topic: string | null,
	documents: CollectContextDocument[],
): CollectContextMemoryPacket {
	const keyFacts = documents
		.flatMap((doc) =>
			doc.evidence_snippets.map((snippet) => `${doc.title}: ${snippet}`),
		)
		.slice(0, 10);

	const experienceBullets = documents
		.map((doc) => `${doc.title}: ${trimWithEllipsis(doc.summary, 180)}`)
		.slice(0, 8);

	const sourceRefs = documents.slice(0, 10).map((doc) => ({
		filePath: doc.fullPath,
		title: doc.title,
		relevance: doc.relevance,
		evidenceSnippets: doc.evidence_snippets.slice(0, 2),
	}));

	const topicSummary =
		documents.length === 0
			? topic
				? `No evidence was collected for topic "${topic}".`
				: "No documents were collected."
			: trimWithEllipsis(
					documents
						.slice(0, 3)
						.map((doc) => `${doc.title}: ${doc.summary}`)
						.join(" "),
					550,
				);

	const openQuestions: string[] = [];
	if (documents.length === 0) {
		openQuestions.push(
			topic
				? `Should we widen the query beyond "${topic}"?`
				: "Should we provide a narrower topic for better precision?",
		);
	}
	if (documents.some((doc) => doc.truncated)) {
		openQuestions.push(
			"Some excerpts were truncated. Do we need full reads for high-priority notes?",
		);
	}
	if (documents.length > 0 && documents.length < 3) {
		openQuestions.push(
			"Do we need additional sources before using this as final memory context?",
		);
	}

	const truncationRatio =
		documents.length === 0
			? 1
			: documents.filter((doc) => doc.truncated).length / documents.length;
	const baseConfidence =
		documents.length === 0
			? 0.25
			: Math.min(0.9, 0.45 + documents.length * 0.08);
	const confidence = Number(
		Math.max(
			0.1,
			Math.min(0.95, baseConfidence - truncationRatio * 0.2),
		).toFixed(2),
	);

	return collectContextMemoryPacketSchema.parse({
		topicSummary,
		keyFacts,
		experienceBullets,
		sourceRefs,
		openQuestions,
		confidence,
	});
}

function buildCollectContextPayload(params: {
	scope: CollectContextScope;
	topic: string | null;
	matchedTotal: number;
	totalInVault: number;
	documents: CollectContextDocument[];
	memoryMode: CollectContextMemoryMode;
	memoryWriteRequested: boolean;
	cache?: {
		key: string;
		hit: boolean;
		schema_version: string;
		topic: string | null;
		doc_hash: string;
		mode: CollectContextMemoryMode;
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
		memory_packet: buildCollectContextMemoryPacket(
			params.topic,
			params.documents,
		),
		memory_mode: params.memoryMode,
		memory_write: params.memoryWriteRequested
			? {
					requested: true,
					status: "failed",
					reason:
						"Memory note write requested but no write result was provided.",
				}
			: { requested: false, status: "not_requested" },
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

		if (doc.summary.length > COLLECT_CONTEXT_MIN_SUMMARY_CHARS) {
			const nextLength = Math.max(
				COLLECT_CONTEXT_MIN_SUMMARY_CHARS,
				Math.floor(doc.summary.length * 0.85),
			);
			const nextSummary = trimWithEllipsis(doc.summary, nextLength);
			if (nextSummary !== doc.summary) {
				doc.summary = nextSummary;
				doc.truncated = true;
				changed = true;
			}
		}

		const nextEvidence = doc.evidence_snippets.map((snippet) => {
			if (snippet.length <= COLLECT_CONTEXT_MIN_EVIDENCE_CHARS) {
				return snippet;
			}
			const nextLength = Math.max(
				COLLECT_CONTEXT_MIN_EVIDENCE_CHARS,
				Math.floor(snippet.length * 0.8),
			);
			return trimWithEllipsis(snippet, nextLength);
		});

		if (
			JSON.stringify(nextEvidence) !== JSON.stringify(doc.evidence_snippets)
		) {
			doc.evidence_snippets = nextEvidence;
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
	mode: CollectContextMemoryMode;
	startCursor: number;
	maxDocs: number;
	maxCharsPerDoc: number;
}): string {
	return JSON.stringify({
		scope: params.scope,
		topic: params.topic,
		doc_hash: params.docHash,
		schema_version: CONTEXT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
		mode: params.mode,
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

function buildCollectContextSourceHash(
	payload: Pick<
		CollectContextPayload,
		"scope" | "topic" | "matched_total" | "documents" | "memory_packet"
	>,
): string {
	const normalized = {
		scope: payload.scope,
		topic: payload.topic,
		matched_total: payload.matched_total,
		documents: payload.documents.map((doc) => ({
			fullPath: doc.fullPath,
			doc_hash: doc.doc_hash,
			title: doc.title,
			tags: doc.tags,
			summary: doc.summary,
			relevance: doc.relevance,
			contentLength: doc.stats.contentLength,
			backlinks_count: doc.backlinks_count,
			truncated: doc.truncated,
		})),
		memory_packet: payload.memory_packet,
	};

	return createHash("sha256")
		.update(JSON.stringify(normalized), "utf8")
		.digest("hex");
}

function buildContextMemorySnapshotMarkdown(params: {
	payload: CollectContextPayload;
	generatedAt: string;
	sourceHash: string;
	notePath: string;
}): string {
	const { payload, generatedAt, sourceHash, notePath } = params;

	const canonical = {
		schema_version: CONTEXT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
		generated_at: generatedAt,
		source_hash: sourceHash,
		note_path: notePath,
		action: payload.action,
		scope: payload.scope,
		topic: payload.topic,
		matched_total: payload.matched_total,
		total_in_vault: payload.total_in_vault,
		documents: payload.documents.map((doc) => ({
			fullPath: doc.fullPath,
			doc_hash: doc.doc_hash,
			title: doc.title,
			tags: doc.tags,
			relevance: doc.relevance,
			summary: doc.summary,
			evidence_snippets: doc.evidence_snippets,
			stats: doc.stats,
			backlinks_count: doc.backlinks_count,
			truncated: doc.truncated,
		})),
		memory_packet: payload.memory_packet,
	};

	const keyFacts = payload.memory_packet.keyFacts
		.slice(0, 8)
		.map((fact) => `- ${fact}`)
		.join("\n");
	const experienceBullets = payload.memory_packet.experienceBullets
		.slice(0, 8)
		.map((item) => `- ${item}`)
		.join("\n");
	const sourceRefs = payload.memory_packet.sourceRefs
		.slice(0, 10)
		.map(
			(ref) =>
				`- [${ref.relevance}] ${ref.title} (${ref.filePath})${ref.evidenceSnippets.length > 0 ? `\n  - ${ref.evidenceSnippets.join("\n  - ")}` : ""}`,
		)
		.join("\n");
	const openQuestions =
		payload.memory_packet.openQuestions.length > 0
			? payload.memory_packet.openQuestions.map((q) => `- ${q}`).join("\n")
			: "- None";

	return [
		"# Context Memory Snapshot v1",
		"",
		`- generated_at: ${generatedAt}`,
		`- source_hash: ${sourceHash}`,
		`- schema_version: ${CONTEXT_MEMORY_SNAPSHOT_SCHEMA_VERSION}`,
		`- topic: ${payload.topic ?? "null"}`,
		`- scope: ${payload.scope}`,
		`- matched_total: ${payload.matched_total}`,
		`- total_in_vault: ${payload.total_in_vault}`,
		"",
		"## Topic Summary",
		payload.memory_packet.topicSummary || "(empty)",
		"",
		"## Key Facts",
		keyFacts || "- None",
		"",
		"## Experience Bullets",
		experienceBullets || "- None",
		"",
		"## Source Refs",
		sourceRefs || "- None",
		"",
		"## Open Questions",
		openQuestions,
		"",
		"## Confidence",
		`${payload.memory_packet.confidence}`,
		"",
		"## Canonical JSON",
		"```json",
		JSON.stringify(canonical, null, 2),
		"```",
		"",
	].join("\n");
}

async function writeContextMemorySnapshotNote(
	vaultManager: VaultManager,
	payload: CollectContextPayload,
): Promise<CollectContextPayload["memory_write"]> {
	const generatedAt = new Date().toISOString();
	const sourceHash = buildCollectContextSourceHash(payload);
	const markdown = buildContextMemorySnapshotMarkdown({
		payload,
		generatedAt,
		sourceHash,
		notePath: CONTEXT_MEMORY_SNAPSHOT_NOTE_PATH,
	});

	try {
		await vaultManager.writeRawDocument(
			CONTEXT_MEMORY_SNAPSHOT_NOTE_PATH,
			markdown,
		);
		return {
			requested: true,
			status: "written",
			note_path: CONTEXT_MEMORY_SNAPSHOT_NOTE_PATH,
			generated_at: generatedAt,
			source_hash: sourceHash,
		};
	} catch (error) {
		return {
			requested: true,
			status: "failed",
			note_path: CONTEXT_MEMORY_SNAPSHOT_NOTE_PATH,
			generated_at: generatedAt,
			source_hash: sourceHash,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
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
			memoryMode: next.memory_mode,
		});
	}

	while (
		jsonCharLength(next) > maxOutputChars &&
		next.memory_packet.keyFacts.length > 3
	) {
		next.memory_packet.keyFacts.pop();
		clamped = true;
	}

	while (
		jsonCharLength(next) > maxOutputChars &&
		next.memory_packet.experienceBullets.length > 3
	) {
		next.memory_packet.experienceBullets.pop();
		clamped = true;
	}

	while (
		jsonCharLength(next) > maxOutputChars &&
		next.memory_packet.sourceRefs.length > 2
	) {
		next.memory_packet.sourceRefs.pop();
		clamped = true;
	}

	while (
		jsonCharLength(next) > maxOutputChars &&
		next.memory_packet.openQuestions.length > 1
	) {
		next.memory_packet.openQuestions.pop();
		clamped = true;
	}

	if (
		jsonCharLength(next) > maxOutputChars &&
		next.memory_packet.topicSummary.length > 200
	) {
		next.memory_packet.topicSummary = trimWithEllipsis(
			next.memory_packet.topicSummary,
			200,
		);
		clamped = true;
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
			memoryMode: validation.data.memoryMode,
		};
	} catch {
		return null;
	}
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
	const memoryMode: CollectContextMemoryMode =
		continuation?.memoryMode ?? params.memoryMode ?? "response_only";
	const startCursor = continuation?.cursor ?? 0;

	if (scope === "topic" && !topic) {
		return createToolError(
			"topic parameter is required for collect_context when scope='topic'",
			'Provide a topic, e.g. { action: "collect_context", topic: "next.js", scope: "topic" }',
		);
	}

	const [allDocuments, matchedCandidates] = await Promise.all([
		vaultManager.getAllDocuments(),
		scope === "all"
			? vaultManager.getAllDocuments()
			: vaultManager.searchDocuments(topic ?? ""),
	]);
	const orderedCandidates = [...matchedCandidates].sort((a, b) =>
		a.filePath.localeCompare(b.filePath),
	);

	const emptyDocHash = buildCollectContextDocHash([]);
	const emptyCacheKey = buildCollectContextCacheKey({
		scope,
		topic,
		docHash: emptyDocHash,
		mode: memoryMode,
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
					memoryMode,
					memoryWriteRequested: false,
					cache: {
						key: emptyCacheKey,
						hit: false,
						schema_version: CONTEXT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
						topic,
						doc_hash: emptyDocHash,
						mode: memoryMode,
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

		if (memoryMode !== "response_only") {
			const memoryWrite = await writeContextMemorySnapshotNote(
				vaultManager,
				emptyPayload,
			);
			emptyPayload = collectContextPayloadSchema.parse({
				...emptyPayload,
				memory_mode: memoryMode,
				memory_write: memoryWrite,
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

		return {
			isError: false,
			content: [
				{ type: "text", text: JSON.stringify(finalizedPayload, null, 2) },
			],
		};
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
			topic,
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
					memoryMode,
					memoryWriteRequested: false,
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
				memoryMode,
			})
		: null;

	const docHash = buildCollectContextDocHash(documents);
	const cacheKey = buildCollectContextCacheKey({
		scope,
		topic,
		docHash: docHash,
		mode: memoryMode,
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
				memoryMode,
				memoryWriteRequested: false,
				cache: {
					key: cacheKey,
					hit: false,
					schema_version: CONTEXT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
					topic,
					doc_hash: docHash,
					mode: memoryMode,
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
							schema_version: CONTEXT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
							topic,
							doc_hash: docHash,
							mode: memoryMode,
						},
			})
		: basePayload;

	if (memoryMode !== "response_only") {
		const memoryWrite = await writeContextMemorySnapshotNote(
			vaultManager,
			basePayload,
		);
		payloadForCompression = collectContextPayloadSchema.parse({
			...basePayload,
			memory_mode: memoryMode,
			memory_write: memoryWrite,
		});
	}
	if (typeof maxOutputChars === "number") {
		const trimmed = trimCollectContextPayloadToOutputLimit(
			payloadForCompression,
			maxOutputChars,
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

	return {
		isError: false,
		content: [
			{ type: "text", text: JSON.stringify(finalizedPayload, null, 2) },
		],
	};
}
