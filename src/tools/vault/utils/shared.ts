import type { ObsidianContentQueryParams } from "../params.js";

export type CompressionMode = "summary" | "aggressive" | "balanced" | "none";

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
	"read",
	Record<Exclude<CompressionMode, "none">, number>
> = {
	read: {
		summary: 1000,
		aggressive: 2200,
		balanced: 4000,
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
