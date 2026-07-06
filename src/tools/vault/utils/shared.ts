import type { ObsidianContentQueryParams } from "../params.js";

export type CompressionMode = "summary" | "aggressive" | "balanced" | "none";

export const SEARCH_DEFAULT_LIMIT: Record<
	Exclude<CompressionMode, "none">,
	number
> = {
	summary: 3,
	aggressive: 3,
	balanced: 5,
};

export const SEARCH_DEFAULT_EXCERPT: Record<
	Exclude<CompressionMode, "none">,
	number
> = {
	summary: 100,
	aggressive: 220,
	balanced: 500,
};

export const READ_DEFAULT_CONTENT_MAX_CHARS: Record<
	Exclude<CompressionMode, "none">,
	number
> = {
	summary: 400,
	aggressive: 1200,
	balanced: 2500,
};

export const READ_DEFAULT_BACKLINK_LIMIT: Record<
	Exclude<CompressionMode, "none">,
	number
> = {
	summary: 0,
	aggressive: 5,
	balanced: 10,
};

export const ACTION_DEFAULT_MAX_OUTPUT_CHARS: Record<
	"search" | "read" | "collect_context" | "load_memory",
	Record<Exclude<CompressionMode, "none">, number>
> = {
	search: {
		summary: 800,
		aggressive: 1800,
		balanced: 2500,
	},
	read: {
		summary: 1000,
		aggressive: 2200,
		balanced: 4000,
	},
	collect_context: {
		summary: 1200,
		aggressive: 2800,
		balanced: 5200,
	},
	load_memory: {
		summary: 1000,
		aggressive: 2000,
		balanced: 3200,
	},
};

export function resolveCompressionMode(
	params: ObsidianContentQueryParams,
): CompressionMode {
	return params.compressionMode ?? "summary";
}

function estimateTokensByChars(chars: number): number {
	return Math.ceil(chars / 3);
}

export function finalizePayloadWithCompression<
	T extends Record<string, unknown>,
>(
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

export function jsonCharLength(data: unknown): number {
	return JSON.stringify(data).length;
}

export function trimWithEllipsis(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.substring(0, maxLength)}...`;
}

export function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function stripFrontmatterBlock(content: string): string {
	if (!content.startsWith("---")) {
		return content;
	}
	const end = content.indexOf("\n---", 3);
	if (end === -1) {
		return content;
	}
	return content.substring(end + 4).trimStart();
}
