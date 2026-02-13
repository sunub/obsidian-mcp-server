import { createHash } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createToolError } from "@/utils/createToolError.js";
import type { DocumentIndex } from "../../utils/processor/types.js";
import type { EnrichedDocument } from "../../utils/VaultManger/types.js";
import type { VaultManager } from "../../utils/VaultManger/VaultManager.js";
import type { ObsidianContentQueryParams } from "./params.js";
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
	collectContextScopeSchema,
	collectContextTokenV1Schema,
} from "./types/collect_context.js";

type CompressionMode = "aggressive" | "balanced" | "none";

const SEARCH_DEFAULT_LIMIT: Record<Exclude<CompressionMode, "none">, number> = {
	aggressive: 3,
	balanced: 5,
};

const SEARCH_DEFAULT_EXCERPT: Record<
	Exclude<CompressionMode, "none">,
	number
> = {
	aggressive: 220,
	balanced: 500,
};

const READ_DEFAULT_CONTENT_MAX_CHARS: Record<
	Exclude<CompressionMode, "none">,
	number
> = {
	aggressive: 1200,
	balanced: 2500,
};

const READ_DEFAULT_BACKLINK_LIMIT: Record<
	Exclude<CompressionMode, "none">,
	number
> = {
	aggressive: 5,
	balanced: 10,
};

const ACTION_DEFAULT_MAX_OUTPUT_CHARS: Record<
	"search" | "read" | "collect_context" | "load_memory",
	Record<Exclude<CompressionMode, "none">, number>
> = {
	search: {
		aggressive: 1800,
		balanced: 2500,
	},
	read: {
		aggressive: 2200,
		balanced: 4000,
	},
	collect_context: {
		aggressive: 2800,
		balanced: 5200,
	},
	load_memory: {
		aggressive: 2000,
		balanced: 3200,
	},
};

const RESUME_CONTEXT_MEMORY_NOTE_PATH = "memory/resume_context.v1.md";
const RESUME_CONTEXT_SCHEMA_VERSION = "resume_context.v1";
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

type LoadMemoryPayload = {
	action: "load_memory";
	found: true;
	memory_path: string;
	has_canonical_json: boolean;
	schema_version: string | null;
	generated_at: string | null;
	source_hash: string | null;
	topic: string | null;
	scope: CollectContextScope | null;
	documents_count: number;
	memory_packet: CollectContextMemoryPacket | null;
	preview: string;
};

function resolveCompressionMode(
	params: ObsidianContentQueryParams,
): CompressionMode {
	return params.compressionMode ?? "balanced";
}

function estimateTokensByChars(chars: number): number {
	return Math.ceil(chars / 3);
}

function finalizePayloadWithCompression<T extends Record<string, unknown>>(
	payload: T,
	compression: {
		mode: CompressionMode;
		source_chars: number;
		max_output_chars: number | null;
		truncated: boolean;
		expand_hint: string;
	},
): T & {
	compression: {
		mode: CompressionMode;
		source_chars: number;
		output_chars: number;
		estimated_tokens: number;
		max_output_chars: number | null;
		truncated: boolean;
		expand_hint: string;
	};
} {
	const output_chars = JSON.stringify(payload).length;
	const estimated_tokens = estimateTokensByChars(output_chars);
	return {
		...payload,
		compression: {
			...compression,
			output_chars,
			estimated_tokens,
		},
	};
}

function jsonCharLength(data: unknown): number {
	return JSON.stringify(data).length;
}

function stripCanonicalJsonBlock(content: string): string {
	const match = content.match(/```json\s*[\s\S]*?```/m);
	if (!match) {
		return content;
	}

	return `${content.slice(0, match.index)}${content.slice((match.index ?? 0) + match[0].length)}`;
}

function extractMarkdownMetaValue(
	content: string,
	key: "generated_at" | "source_hash" | "schema_version",
): string | null {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`^-\\s*${escapedKey}:\\s*(.+)$`, "m");
	const matched = content.match(regex);
	if (!matched?.[1]) {
		return null;
	}
	return matched[1].trim();
}

function parseCanonicalJsonBlock(
	content: string,
): Record<string, unknown> | null {
	const match = content.match(/```json\s*([\s\S]*?)```/m);
	if (!match?.[1]) {
		return null;
	}

	try {
		const parsed = JSON.parse(match[1]);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return null;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

function buildLoadMemoryPayload(
	notePath: string,
	content: string,
	preview: string,
): LoadMemoryPayload {
	const canonical = parseCanonicalJsonBlock(content);
	const memoryPacketCandidate = canonical?.memory_packet;
	const parsedMemoryPacket = collectContextMemoryPacketSchema.safeParse(
		memoryPacketCandidate,
	);
	const memoryPacket = parsedMemoryPacket.success
		? parsedMemoryPacket.data
		: null;
	const scopeCandidate = collectContextScopeSchema.safeParse(canonical?.scope);
	const scope = scopeCandidate.success ? scopeCandidate.data : null;
	const topic =
		typeof canonical?.topic === "string"
			? canonical.topic
			: canonical?.topic === null
				? null
				: null;
	const documentsCount = Array.isArray(canonical?.documents)
		? canonical.documents.length
		: 0;
	const schemaVersion =
		typeof canonical?.schema_version === "string"
			? canonical.schema_version
			: extractMarkdownMetaValue(content, "schema_version");
	const generatedAt =
		typeof canonical?.generated_at === "string"
			? canonical.generated_at
			: extractMarkdownMetaValue(content, "generated_at");
	const sourceHash =
		typeof canonical?.source_hash === "string"
			? canonical.source_hash
			: extractMarkdownMetaValue(content, "source_hash");

	return {
		action: "load_memory",
		found: true,
		memory_path: notePath,
		has_canonical_json: canonical !== null,
		schema_version: schemaVersion,
		generated_at: generatedAt,
		source_hash: sourceHash,
		topic,
		scope,
		documents_count: documentsCount,
		memory_packet: memoryPacket,
		preview,
	};
}

function clampLoadMemoryPayloadByOutputChars(
	payload: LoadMemoryPayload,
	maxOutputChars: number,
): { payload: LoadMemoryPayload; clamped: boolean } {
	const next = structuredClone(payload);
	let clamped = false;

	if (!next.memory_packet) {
		if (jsonCharLength(next) > maxOutputChars && next.preview.length > 400) {
			next.preview = trimWithEllipsis(next.preview, 400);
			clamped = true;
		}
		return { payload: next, clamped };
	}

	while (
		jsonCharLength(next) > maxOutputChars &&
		next.memory_packet.sourceRefs.length > 3
	) {
		next.memory_packet.sourceRefs.pop();
		clamped = true;
	}

	while (
		jsonCharLength(next) > maxOutputChars &&
		next.memory_packet.keyFacts.length > 5
	) {
		next.memory_packet.keyFacts.pop();
		clamped = true;
	}

	while (
		jsonCharLength(next) > maxOutputChars &&
		next.memory_packet.experienceBullets.length > 5
	) {
		next.memory_packet.experienceBullets.pop();
		clamped = true;
	}

	if (jsonCharLength(next) > maxOutputChars && next.preview.length > 400) {
		next.preview = trimWithEllipsis(next.preview, 400);
		clamped = true;
	}

	return { payload: next, clamped };
}

function trimWithEllipsis(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.substring(0, maxLength)}...`;
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function stripFrontmatterBlock(content: string): string {
	if (!content.startsWith("---")) {
		return content;
	}
	const end = content.indexOf("\n---", 3);
	if (end === -1) {
		return content;
	}
	return content.substring(end + 4).trimStart();
}

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
		schema_version: RESUME_CONTEXT_SCHEMA_VERSION,
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

function buildResumeContextMarkdown(params: {
	payload: CollectContextPayload;
	generatedAt: string;
	sourceHash: string;
	notePath: string;
}): string {
	const { payload, generatedAt, sourceHash, notePath } = params;

	const canonical = {
		schema_version: RESUME_CONTEXT_SCHEMA_VERSION,
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
		"# Resume Context v1",
		"",
		`- generated_at: ${generatedAt}`,
		`- source_hash: ${sourceHash}`,
		`- schema_version: ${RESUME_CONTEXT_SCHEMA_VERSION}`,
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

async function writeResumeContextMemoryNote(
	vaultManager: VaultManager,
	payload: CollectContextPayload,
): Promise<CollectContextPayload["memory_write"]> {
	const generatedAt = new Date().toISOString();
	const sourceHash = buildCollectContextSourceHash(payload);
	const markdown = buildResumeContextMarkdown({
		payload,
		generatedAt,
		sourceHash,
		notePath: RESUME_CONTEXT_MEMORY_NOTE_PATH,
	});

	try {
		await vaultManager.writeRawDocument(
			RESUME_CONTEXT_MEMORY_NOTE_PATH,
			markdown,
		);
		return {
			requested: true,
			status: "written",
			note_path: RESUME_CONTEXT_MEMORY_NOTE_PATH,
			generated_at: generatedAt,
			source_hash: sourceHash,
		};
	} catch (error) {
		return {
			requested: true,
			status: "failed",
			note_path: RESUME_CONTEXT_MEMORY_NOTE_PATH,
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

	// Guardrail step 1: backlinks reduction
	if (
		jsonCharLength(next) > maxOutputChars &&
		reduceCollectContextBacklinksForBudget(next.documents)
	) {
		clamped = true;
	}

	// Guardrail step 2: per-doc char reduction
	while (jsonCharLength(next) > maxOutputChars) {
		const reduced = reduceCollectContextPerDocCharsForBudget(next.documents);
		if (!reduced) {
			break;
		}
		clamped = true;
	}

	// Guardrail step 3: doc count reduction
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

	// Additional memory packet trimming for extreme limits.
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

function clampSearchPayloadByOutputChars<
	T extends {
		found: number;
		documents: Array<{
			content:
				| { full: string; excerpt: string }
				| { preview: string; note: string };
		}>;
	},
>(payload: T, maxOutputChars: number): { payload: T; clamped: boolean } {
	const next = structuredClone(payload);
	let clamped = false;

	while (jsonCharLength(next) > maxOutputChars && next.documents.length > 1) {
		next.documents.pop();
		next.found = next.documents.length;
		clamped = true;
	}

	if (jsonCharLength(next) <= maxOutputChars) {
		return { payload: next, clamped };
	}

	for (const doc of next.documents) {
		if ("full" in doc.content) {
			if (doc.content.full.length > 600) {
				doc.content.full = `${doc.content.full.substring(0, 600)}...`;
			}
			if (doc.content.excerpt.length > 300) {
				doc.content.excerpt = `${doc.content.excerpt.substring(0, 300)}...`;
			}
			clamped = true;
		}
	}

	return { payload: next, clamped };
}

function clampReadPayloadByOutputChars<
	T extends {
		content: string;
		backlinks?: Array<{ filePath: string; title: string }>;
	},
>(payload: T, maxOutputChars: number): { payload: T; clamped: boolean } {
	const next = structuredClone(payload);
	let clamped = false;

	while (
		jsonCharLength(next) > maxOutputChars &&
		(next.backlinks?.length ?? 0) > 3
	) {
		next.backlinks = next.backlinks?.slice(0, next.backlinks.length - 1);
		clamped = true;
	}

	while (jsonCharLength(next) > maxOutputChars && next.content.length > 400) {
		next.content = `${next.content.substring(0, Math.floor(next.content.length * 0.7))}...`;
		clamped = true;
	}

	return { payload: next, clamped };
}

async function getDocumentContent(
	vaultManager: VaultManager,
	filename: string,
	maxContentPreview?: number,
): Promise<Partial<EnrichedDocument>> {
	const doc = await vaultManager.getDocumentInfo(filename, {
		includeStats: true,
		maxContentPreview: maxContentPreview,
	});
	if (!doc) return {};
	return doc;
}

function formatDocument(
	doc: DocumentIndex | EnrichedDocument,
	includeContent: boolean,
	excerptLength?: number,
) {
	const hasContentProperty =
		"content" in doc && typeof doc.content === "string";
	const sourceContentLength =
		"stats" in doc && doc.stats ? doc.stats.contentLength : doc.contentLength;
	const contentIsTruncated =
		!!excerptLength &&
		hasContentProperty &&
		typeof sourceContentLength === "number" &&
		sourceContentLength > doc.content.length;

	// content 필드를 생성하는 로직을 명확하게 분리
	const createContentObject = () => {
		if (includeContent && hasContentProperty) {
			// FullContentSchema 형태
			const excerpt =
				excerptLength && doc.content?.length > excerptLength
					? `${doc.content?.substring(0, excerptLength)}...`
					: doc.content;
			return {
				full: doc.content,
				excerpt: excerpt,
			};
		} else {
			// PreviewContentSchema 형태
			return {
				preview: "(Content not loaded)",
				note: "Full content available with includeContent=true",
			};
		}
	};

	return {
		filename: doc.filePath.split("/").pop() || doc.filePath,
		fullPath: doc.filePath,
		metadata: {
			title: doc.frontmatter.title || "Untitled",
			tags: doc.frontmatter.tags || [],
		},
		stats:
			"stats" in doc && doc.stats
				? doc.stats
				: {
						contentLength: doc.contentLength,
						hasContent: hasContentProperty,
						wordCount: 0,
					},
		content: createContentObject(), // 항상 객체를 반환
		content_is_truncated: contentIsTruncated,
	};
}

export async function searchDocuments(
	vaultManager: VaultManager,
	params: ObsidianContentQueryParams,
): Promise<CallToolResult> {
	await vaultManager.initialize();
	const mode = resolveCompressionMode(params);
	const searchResults = await vaultManager.searchDocuments(
		params.keyword || "",
	);

	if (params.quiet) {
		return {
			isError: false,
			content: [
				{
					type: "text",
					text: JSON.stringify({
						found: searchResults.length,
						filenames: searchResults.map(
							(doc) => doc.filePath.split("/").pop() || doc.filePath,
						),
					}),
				},
			],
		};
	}

	const defaultLimit =
		mode === "none" ? searchResults.length : SEARCH_DEFAULT_LIMIT[mode];
	const effectiveLimit = params.limit ?? defaultLimit;
	const limitedResults = searchResults.slice(0, effectiveLimit);

	const effectiveExcerptLength =
		params.excerptLength ??
		(mode === "none" ? undefined : SEARCH_DEFAULT_EXCERPT[mode]);

	const documentsData = await Promise.all(
		limitedResults.map(async (doc) => {
			if (params.includeContent) {
				const fullDoc = await getDocumentContent(
					vaultManager,
					doc.filePath,
					effectiveExcerptLength,
				);
				return formatDocument(
					{ ...doc, ...fullDoc },
					true,
					effectiveExcerptLength,
				);
			}
			return formatDocument(doc, false);
		}),
	);

	const sourceChars = limitedResults.reduce(
		(sum, doc) => sum + doc.contentLength,
		0,
	);
	const maxOutputChars =
		params.maxOutputChars ??
		(mode === "none" ? null : ACTION_DEFAULT_MAX_OUTPUT_CHARS.search[mode]);
	const basePayload = {
		query: params.keyword,
		found: documentsData.length,
		matched_total: searchResults.length,
		total_in_vault: (await vaultManager.getAllDocuments()).length,
		documents: documentsData,
	};

	let payloadForCompression = basePayload;
	let outputCapClamped = false;
	if (typeof maxOutputChars === "number") {
		const clamped = clampSearchPayloadByOutputChars(
			basePayload,
			maxOutputChars,
		);
		payloadForCompression = clamped.payload;
		outputCapClamped = clamped.clamped;
	}

	const isTruncated =
		limitedResults.length < searchResults.length ||
		documentsData.some((doc) => doc.content_is_truncated) ||
		outputCapClamped;
	const payload = finalizePayloadWithCompression(payloadForCompression, {
		mode,
		source_chars: sourceChars,
		max_output_chars: maxOutputChars,
		truncated: isTruncated,
		expand_hint:
			"If you need full raw text, call vault action='read' with compressionMode='none'.",
	});

	return {
		isError: false,
		content: [
			{
				type: "text",
				text: JSON.stringify(payload, null, 2),
			},
		],
	};
}

export async function readSpecificFile(
	vaultManager: VaultManager,
	params: ObsidianContentQueryParams,
): Promise<CallToolResult> {
	await vaultManager.initialize();
	const mode = resolveCompressionMode(params);

	const doc = await vaultManager.getDocumentInfo(params.filename ?? "", {
		includeStats: true,
		includeBacklinks: true,
	});

	if (!doc) {
		return createToolError(
			`Document not found: ${params.filename}`,
			"Check the filename and try again. Use the vault tool with 'list_all' action to see available documents.",
		);
	}

	const sourceContentChars = doc.content.length;
	const readContentMaxChars =
		params.excerptLength ??
		(mode === "none"
			? Number.POSITIVE_INFINITY
			: READ_DEFAULT_CONTENT_MAX_CHARS[mode]);
	const shouldTruncateContent = sourceContentChars > readContentMaxChars;
	const compressedContent = shouldTruncateContent
		? `${doc.content.substring(0, readContentMaxChars)}...`
		: doc.content;

	const backlinkLimit =
		mode === "none" ? undefined : READ_DEFAULT_BACKLINK_LIMIT[mode];
	const limitedBacklinks = backlinkLimit
		? (doc.backlinks ?? []).slice(0, backlinkLimit)
		: doc.backlinks;

	const truncatedBacklinks =
		!!backlinkLimit &&
		(doc.backlinks?.length ?? 0) > (limitedBacklinks?.length ?? 0);
	const maxOutputChars =
		params.maxOutputChars ??
		(mode === "none" ? null : ACTION_DEFAULT_MAX_OUTPUT_CHARS.read[mode]);
	const basePayload = {
		...doc,
		content: compressedContent,
		backlinks: limitedBacklinks,
	};
	let payloadForCompression = basePayload;
	let outputCapClamped = false;
	if (typeof maxOutputChars === "number") {
		const clamped = clampReadPayloadByOutputChars(basePayload, maxOutputChars);
		payloadForCompression = clamped.payload;
		outputCapClamped = clamped.clamped;
	}
	const payload = finalizePayloadWithCompression(payloadForCompression, {
		mode,
		source_chars: sourceContentChars,
		max_output_chars: maxOutputChars,
		truncated: shouldTruncateContent || truncatedBacklinks || outputCapClamped,
		expand_hint:
			"If you need complete raw text, call vault action='read' with compressionMode='none'.",
	});

	return {
		isError: false,
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
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
						schema_version: RESUME_CONTEXT_SCHEMA_VERSION,
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
			const memoryWrite = await writeResumeContextMemoryNote(
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

				// Guardrail step 1: reduce backlinks metadata first.
				if (reduceCollectContextBacklinksForBudget(documents)) {
					provisionalPayload = buildProvisionalPayload();
				}

				// Guardrail step 2: reduce per-doc chars until payload fits or cannot shrink further.
				while (jsonCharLength(provisionalPayload) > maxOutputChars) {
					const reduced = reduceCollectContextPerDocCharsForBudget(documents);
					if (!reduced) {
						break;
					}
					provisionalPayload = buildProvisionalPayload();
				}

				// Guardrail step 3: reduce doc count when still over budget.
				if (jsonCharLength(provisionalPayload) > maxOutputChars) {
					if (documents.length > 1) {
						const removedDoc = documents.pop();
						if (removedDoc) {
							sourceChars -= removedDoc.stats.contentLength;
						}
						consumedCandidates--;
						scannedIndex--;
					}

					// Guardrail step 4: hand off remaining work to continuation.
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
		docHash,
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
					schema_version: RESUME_CONTEXT_SCHEMA_VERSION,
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
							schema_version: RESUME_CONTEXT_SCHEMA_VERSION,
							topic,
							doc_hash: docHash,
							mode: memoryMode,
						},
			})
		: basePayload;
	if (memoryMode !== "response_only") {
		const memoryWrite = await writeResumeContextMemoryNote(
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

export async function loadMemory(
	vaultManager: VaultManager,
	params: ObsidianContentQueryParams,
): Promise<CallToolResult> {
	await vaultManager.initialize();
	const mode = resolveCompressionMode(params);
	const memoryPath =
		params.memoryPath?.trim() || RESUME_CONTEXT_MEMORY_NOTE_PATH;

	const memoryNote = await vaultManager.getDocumentInfo(memoryPath, {
		includeStats: true,
	});

	if (!memoryNote) {
		return createToolError(
			`Memory note not found: ${memoryPath}`,
			"Run collect_context with memoryMode='vault_note' or 'both' first.",
		);
	}

	const noteBody = stripFrontmatterBlock(memoryNote.content);
	const noteWithoutCanonical = stripCanonicalJsonBlock(noteBody);
	const normalizedNote = normalizeWhitespace(noteWithoutCanonical);
	const previewSource =
		normalizedNote.length > 0
			? normalizedNote
			: "Stored memory note exists but has no readable summary section.";
	const previewLimit =
		params.excerptLength ?? (mode === "none" ? previewSource.length : 900);
	const preview =
		params.includeContent === false
			? "(preview disabled: set includeContent=true to include memory preview)"
			: trimWithEllipsis(previewSource, previewLimit);
	const previewTruncated = preview.length < previewSource.length;

	if (params.quiet) {
		const quietPayload = buildLoadMemoryPayload(
			memoryNote.filePath,
			noteBody,
			"",
		);
		return {
			isError: false,
			content: [
				{
					type: "text",
					text: JSON.stringify({
						found: true,
						memory_path: quietPayload.memory_path,
						has_canonical_json: quietPayload.has_canonical_json,
						topic: quietPayload.topic,
						scope: quietPayload.scope,
						schema_version: quietPayload.schema_version,
					}),
				},
			],
		};
	}

	const sourceChars = noteBody.length;
	const maxOutputChars =
		params.maxOutputChars ??
		(mode === "none"
			? null
			: ACTION_DEFAULT_MAX_OUTPUT_CHARS.load_memory[mode]);

	const basePayload = buildLoadMemoryPayload(
		memoryNote.filePath,
		noteBody,
		preview,
	);
	let payloadForCompression = basePayload;
	let outputCapClamped = false;
	if (typeof maxOutputChars === "number") {
		const clamped = clampLoadMemoryPayloadByOutputChars(
			basePayload,
			maxOutputChars,
		);
		payloadForCompression = clamped.payload;
		outputCapClamped = clamped.clamped;
	}

	const finalizedPayload = finalizePayloadWithCompression(
		payloadForCompression,
		{
			mode,
			source_chars: sourceChars,
			max_output_chars: maxOutputChars,
			truncated: previewTruncated || outputCapClamped,
			expand_hint:
				"If memory note is stale, rerun collect_context with memoryMode='both'.",
		},
	);

	return {
		isError: false,
		content: [
			{ type: "text", text: JSON.stringify(finalizedPayload, null, 2) },
		],
	};
}

export async function listAllDocuments(
	vaultManager: VaultManager,
	params: ObsidianContentQueryParams,
): Promise<CallToolResult> {
	await vaultManager.initialize();
	const allDocuments = await vaultManager.getAllDocuments();
	const limitedDocs = allDocuments.slice(0, params.limit || 50);

	if (params.quiet) {
		return {
			isError: false,
			content: [
				{
					type: "text",
					text: JSON.stringify({
						total_documents: allDocuments.length,
						filenames: allDocuments.map(
							(doc) => doc.filePath.split("/").pop() || doc.filePath,
						),
					}),
				},
			],
		};
	}

	const documentsOverview = await Promise.all(
		limitedDocs.map(async (doc) => {
			if (params.includeContent) {
				const fullDoc = await getDocumentContent(
					vaultManager,
					doc.filePath,
					200,
				);
				return formatDocument({ ...doc, ...fullDoc }, true, 200);
			}
			return formatDocument(doc, false);
		}),
	);

	return {
		isError: false,
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						vault_overview: {
							total_documents: allDocuments.length,
							showing: limitedDocs.length,
						},
						documents: documentsOverview,
					},
					null,
					2,
				),
			},
		],
	};
}

export async function statsAllDocuments(
	vaultManager: VaultManager,
): Promise<CallToolResult> {
	await vaultManager.initialize();
	const stats = vaultManager.getStats();
	return {
		isError: false,
		content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
	};
}
