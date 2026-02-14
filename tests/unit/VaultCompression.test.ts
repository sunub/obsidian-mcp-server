import { describe, expect, test, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VaultManager } from "../../src/utils/VaultManger/VaultManager.js";
import type { EnrichedDocument } from "../../src/utils/VaultManger/types.js";
import type { DocumentIndex } from "../../src/utils/processor/types.js";
import { readSpecificFile, searchDocuments } from "../../src/tools/vault/utils.js";
import {
	READ_DEFAULT_BACKLINK_LIMIT,
	SEARCH_DEFAULT_EXCERPT,
} from "../../src/tools/vault/utils/shared.js";

function firstText(result: CallToolResult): string {
	const first = result.content?.[0];
	if (!first || first.type !== "text") {
		throw new Error("Expected text content in tool result");
	}
	return first.text;
}

const searchPayloadSchema = z.object({
	compression: z.object({
		mode: z.enum(["aggressive", "balanced", "none"]),
		truncated: z.boolean(),
	}),
	documents: z.array(
		z.object({
			content_is_truncated: z.boolean(),
			content: z.object({
				full: z.string(),
			}),
		}),
	),
});

const readPayloadSchema = z.object({
	compression: z.object({
		mode: z.enum(["aggressive", "balanced", "none"]),
		truncated: z.boolean(),
	}),
	content: z.string(),
	backlinks: z.array(
		z.object({
			filePath: z.string(),
			title: z.string(),
		}),
	),
});

function createMockVaultManager() {
	const indexedDoc: DocumentIndex = {
		filePath: "/vault/alpha.md",
		frontmatter: { title: "Alpha", tags: ["tag"] },
		contentLength: 4000,
		imageLinks: [],
		documentLinks: [],
	};

	const enrichedDoc: EnrichedDocument = {
		...indexedDoc,
		content: "A".repeat(4000),
		stats: {
			wordCount: 700,
			lineCount: 120,
			characterCount: 4000,
			contentLength: 4000,
			hasContent: true,
		},
		backlinks: Array.from({ length: 20 }).map((_, i) => ({
			filePath: `/vault/link-${i}.md`,
			title: `Link ${i}`,
		})),
	};

	const manager: Pick<
		VaultManager,
		"initialize" | "searchDocuments" | "getAllDocuments" | "getDocumentInfo"
	> = {
		initialize: vi.fn(async () => {}),
		searchDocuments: vi.fn(async () => [indexedDoc]),
		getAllDocuments: vi.fn(async () => [indexedDoc]),
		getDocumentInfo: vi.fn(
			async (
				filename: string,
				options?: Parameters<VaultManager["getDocumentInfo"]>[1],
			): Promise<EnrichedDocument | null> => {
				if (filename !== "/vault/alpha.md" && filename !== "alpha.md") {
					return null;
				}

				const maxPreview = options?.maxContentPreview;
				if (!maxPreview) {
					return enrichedDoc;
				}

				const previewContent =
					enrichedDoc.content.substring(0, maxPreview) +
					(enrichedDoc.content.length > maxPreview ? "..." : "");

				return {
					...enrichedDoc,
					content: previewContent,
				};
			},
		),
	};

	return manager as unknown as VaultManager;
}

describe("Vault compression policy", () => {
	test("search action uses balanced compression by default", async () => {
		const vaultManager = createMockVaultManager();

		const result = await searchDocuments(vaultManager, {
			action: "search",
			keyword: "alpha",
			includeContent: true,
		});

		expect(result.isError).toBe(false);
		const payload = searchPayloadSchema.parse(
			JSON.parse(firstText(result)),
		);

		expect(payload.compression.mode).toBe("balanced");
		expect(payload.compression.truncated).toBe(true);
		expect(payload.documents).toHaveLength(1);
		expect(payload.documents[0].content_is_truncated).toBe(true);
		expect(payload.documents[0].content.full.length).toBeLessThanOrEqual(
			SEARCH_DEFAULT_EXCERPT.balanced + 3,
		);
	});

	test("read action keeps full content when compressionMode is none", async () => {
		const vaultManager = createMockVaultManager();

		const result = await readSpecificFile(vaultManager, {
			action: "read",
			filename: "/vault/alpha.md",
			compressionMode: "none",
		});

		expect(result.isError).toBe(false);
		const payload = readPayloadSchema.parse(
			JSON.parse(firstText(result)),
		);

		expect(payload.compression.mode).toBe("none");
		expect(payload.compression.truncated).toBe(false);
		expect(payload.content.length).toBe(4000);
		expect(payload.backlinks.length).toBe(20);
	});

	test("read action aggressively compresses content and backlinks", async () => {
		const vaultManager = createMockVaultManager();

		const result = await readSpecificFile(vaultManager, {
			action: "read",
			filename: "/vault/alpha.md",
			compressionMode: "aggressive",
		});

		expect(result.isError).toBe(false);
		const payload = readPayloadSchema.parse(
			JSON.parse(firstText(result)),
		);

		expect(payload.compression.mode).toBe("aggressive");
		expect(payload.compression.truncated).toBe(true);
		expect(payload.content.length).toBeLessThan(4000);
		expect(payload.backlinks.length).toBeLessThanOrEqual(
			READ_DEFAULT_BACKLINK_LIMIT.aggressive,
		);
	});
});
