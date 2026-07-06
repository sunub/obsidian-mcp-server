import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createToolError } from "@/utils/createToolError.js";
import { localModelManager } from "@/utils/LocalModelManager.js";
import { localReranker } from "@/utils/LocalReranker.js";
import type { VaultManager } from "../../../../utils/VaultManger/VaultManager.js";
import type { ObsidianContentQueryParams } from "../../params.js";
import {
	ACTION_DEFAULT_MAX_OUTPUT_CHARS,
	type CompressionMode,
	finalizePayloadWithCompression,
	jsonCharLength,
	READ_DEFAULT_BACKLINK_LIMIT,
	READ_DEFAULT_CONTENT_MAX_CHARS,
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
		includeStats: mode !== "summary",
		includeBacklinks: mode !== "summary",
	});

	if (!doc) {
		return createToolError(
			`Document not found: ${params.filename}`,
			"Check the filename and try again. Use the vault tool with 'list_all' action to see available documents.",
		);
	}

	const sourceContentChars = doc.content.length;
	let compressedContent = doc.content;
	let shouldTruncateContent = false;

	if (mode === "summary") {
		const docSummary = doc.frontmatter?.summary;
		if (docSummary) {
			compressedContent = `[Summary]\n${docSummary}`;
		} else {
			const lines = doc.content.split("\n");
			const headers = lines.filter((l) => l.trim().startsWith("#")).slice(0, 8).join("\n");
			const firstParagraph = lines.find(
				(l) => l.trim().length > 0 && !l.trim().startsWith("#") && !l.trim().startsWith("---")
			);
			compressedContent = `[Table of Contents]\n${headers || "(No headers)"}\n\n[Excerpt]\n${firstParagraph || ""}`;
		}
		shouldTruncateContent = true;
	} else if (params.query?.trim()) {
		const paragraphs = doc.content
			.split(/\n\s*\n/)
			.map((p) => p.trim())
			.filter((p) => p.length > 0);

		if (paragraphs.length > 0) {
			try {
				await localModelManager.withReranker(3000, async (rerankerReady) => {
					if (rerankerReady) {
						const reranked = await localReranker.rerank(params.query!, paragraphs);
						const topParagraphs = reranked.slice(0, 3).map((r) => r.document);
						const selectedParagraphs = paragraphs.filter((p) =>
							topParagraphs.includes(p),
						);
						compressedContent = selectedParagraphs.join("\n\n");
						shouldTruncateContent = paragraphs.length > selectedParagraphs.length;
					} else {
						throw new Error("Local reranker is warming");
					}
				});
			} catch {
				const readContentMaxChars =
					params.excerptLength ??
					(mode === "none"
						? Number.POSITIVE_INFINITY
						: READ_DEFAULT_CONTENT_MAX_CHARS[mode as Exclude<CompressionMode, "none">]);
				shouldTruncateContent = sourceContentChars > readContentMaxChars;
				compressedContent = shouldTruncateContent
					? `${doc.content.substring(0, readContentMaxChars)}...`
					: doc.content;
			}
		}
	} else {
		const readContentMaxChars =
			params.excerptLength ??
			(mode === "none"
				? Number.POSITIVE_INFINITY
				: READ_DEFAULT_CONTENT_MAX_CHARS[mode as Exclude<CompressionMode, "none">]);
		shouldTruncateContent = sourceContentChars > readContentMaxChars;
		compressedContent = shouldTruncateContent
			? `${doc.content.substring(0, readContentMaxChars)}...`
			: doc.content;
	}

	const backlinkLimit =
		mode === "none" ? undefined : READ_DEFAULT_BACKLINK_LIMIT[mode as Exclude<CompressionMode, "none">];
	const limitedBacklinks = backlinkLimit
		? (doc.backlinks ?? []).slice(0, backlinkLimit)
		: doc.backlinks;

	const truncatedBacklinks =
		!!backlinkLimit &&
		(doc.backlinks?.length ?? 0) > (limitedBacklinks?.length ?? 0);
	const maxOutputChars =
		params.maxOutputChars ??
		(mode === "none" ? null : ACTION_DEFAULT_MAX_OUTPUT_CHARS.read[mode as Exclude<CompressionMode, "none">]);

	const basePayload: {
		filePath: string;
		frontmatter: typeof doc.frontmatter;
		content: string;
		stats?: typeof doc.stats;
		backlinks?: typeof doc.backlinks;
	} = {
		filePath: doc.filePath,
		frontmatter: doc.frontmatter,
		content: compressedContent,
	};
	if (mode !== "summary") {
		basePayload.stats = doc.stats;
		basePayload.backlinks = limitedBacklinks;
	}
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
			"If you need complete raw text, call vault action='read' with compressionMode='none'. However, if the document is long and causes context limit errors, add a 'query' parameter to filter for the most relevant paragraphs.",
	});

	return {
		isError: false,
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
	};
}
