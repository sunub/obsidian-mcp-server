import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createToolError } from "@/utils/createToolError.js";
import type { VaultManager } from "../../../../utils/VaultManger/VaultManager.js";
import type { ObsidianContentQueryParams } from "../../params.js";
import {
	ACTION_DEFAULT_MAX_OUTPUT_CHARS,
	READ_DEFAULT_BACKLINK_LIMIT,
	READ_DEFAULT_CONTENT_MAX_CHARS,
	finalizePayloadWithCompression,
	jsonCharLength,
	resolveCompressionMode,
} from "../shared.js";

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
