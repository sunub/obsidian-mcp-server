import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createToolError } from "@/utils/createToolError.js";
import type { VaultManager } from "../../../../utils/VaultManger/VaultManager.js";
import type { ObsidianContentQueryParams } from "../../params.js";
import {
	type CollectContextMemoryPacket,
	type CollectContextScope,
	collectContextMemoryPacketSchema,
	collectContextScopeSchema,
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

export async function loadMemory(
	vaultManager: VaultManager,
	params: ObsidianContentQueryParams,
): Promise<CallToolResult> {
	await vaultManager.initialize();
	const mode = resolveCompressionMode(params);
	const memoryPath =
		params.memoryPath?.trim() || CONTEXT_MEMORY_SNAPSHOT_NOTE_PATH;

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
						schema_version:
							quietPayload.schema_version ??
							CONTEXT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
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
