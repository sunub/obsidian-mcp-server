import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type VaultAction =
	| "search"
	| "read"
	| "list_all"
	| "stats"
	| "collect_context"
	| "load_memory";

type CompressionSummary = {
	mode: "aggressive" | "balanced" | "none";
	estimated_tokens: number;
	truncated: boolean;
	output_chars: number;
	source_chars: number;
	max_output_chars: number | null;
};

export type VaultResponseMetric = {
	timestamp: string;
	action: VaultAction;
	mode: CompressionSummary["mode"];
	estimated_tokens: number;
	truncated: boolean;
	doc_count: number;
	output_chars: number;
	source_chars: number;
	max_output_chars: number | null;
	cache_hit?: boolean;
};

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseFirstTextPayload(result: CallToolResult): JsonObject | null {
	if (!Array.isArray(result.content)) {
		return null;
	}

	let textPayload: string | null = null;
	for (const chunk of result.content) {
		if (chunk.type !== "text") {
			continue;
		}
		if (!("text" in chunk) || typeof chunk.text !== "string") {
			continue;
		}
		textPayload = chunk.text;
		break;
	}
	if (!textPayload) return null;

	try {
		const parsed = JSON.parse(textPayload);
		return isJsonObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function parseCompression(compression: unknown): CompressionSummary | null {
	if (!isJsonObject(compression)) {
		return null;
	}

	const mode = compression.mode;
	const estimatedTokens = compression.estimated_tokens;
	const truncated = compression.truncated;
	const outputChars = compression.output_chars;
	const sourceChars = compression.source_chars;
	const maxOutputChars = compression.max_output_chars;

	if (
		(mode !== "aggressive" && mode !== "balanced" && mode !== "none") ||
		typeof estimatedTokens !== "number" ||
		typeof truncated !== "boolean" ||
		typeof outputChars !== "number" ||
		typeof sourceChars !== "number" ||
		(maxOutputChars !== null && typeof maxOutputChars !== "number")
	) {
		return null;
	}

	return {
		mode,
		estimated_tokens: Math.max(0, Math.floor(estimatedTokens)),
		truncated,
		output_chars: Math.max(0, Math.floor(outputChars)),
		source_chars: Math.max(0, Math.floor(sourceChars)),
		max_output_chars:
			maxOutputChars === null ? null : Math.max(0, Math.floor(maxOutputChars)),
	};
}

function inferDocCount(action: VaultAction, payload: JsonObject): number {
	if (Array.isArray(payload.documents)) {
		return payload.documents.length;
	}

	if (typeof payload.documents_count === "number") {
		return Math.max(0, Math.floor(payload.documents_count));
	}

	if (action === "search" && typeof payload.found === "number") {
		return Math.max(0, Math.floor(payload.found));
	}

	if (
		action === "read" &&
		(typeof payload.filename === "string" ||
			typeof payload.fullPath === "string" ||
			typeof payload.filePath === "string")
	) {
		return 1;
	}

	return 0;
}

function parseCacheHit(payload: JsonObject): boolean | undefined {
	if (!isJsonObject(payload.cache)) {
		return undefined;
	}
	if (typeof payload.cache.hit !== "boolean") {
		return undefined;
	}
	return payload.cache.hit;
}

export function buildVaultResponseMetric(
	action: VaultAction,
	result: CallToolResult,
): VaultResponseMetric | null {
	if (result.isError) {
		return null;
	}

	const payload = parseFirstTextPayload(result);
	if (!payload) {
		return null;
	}

	const compression = parseCompression(payload.compression);
	if (!compression) {
		return null;
	}

	return {
		timestamp: new Date().toISOString(),
		action,
		mode: compression.mode,
		estimated_tokens: compression.estimated_tokens,
		truncated: compression.truncated,
		doc_count: inferDocCount(action, payload),
		output_chars: compression.output_chars,
		source_chars: compression.source_chars,
		max_output_chars: compression.max_output_chars,
		cache_hit: parseCacheHit(payload),
	};
}

export async function recordVaultResponseMetric(
	action: VaultAction,
	result: CallToolResult,
): Promise<void> {
	const logPath = process.env.VAULT_METRICS_LOG_PATH?.trim();
	if (!logPath) {
		return;
	}

	const metric = buildVaultResponseMetric(action, result);
	if (!metric) {
		return;
	}

	try {
		await mkdir(dirname(logPath), { recursive: true });
		await appendFile(logPath, `${JSON.stringify(metric)}\n`, "utf8");
	} catch {
		// Metrics logging should never fail tool execution.
	}
}
