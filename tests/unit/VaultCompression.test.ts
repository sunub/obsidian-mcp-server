import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type { DocumentIndex } from "../../src/shared/markdown/types.js";
import type { EnrichedDocument } from "../../src/shared/vault-manager/types.js";
import type { VaultManager } from "../../src/shared/vault-manager/VaultManager.js";
import { READ_DEFAULT_BACKLINK_LIMIT } from "../../src/tools/vault/utils/shared.js";
import { readSpecificFile } from "../../src/tools/vault/utils.js";

function firstText(result: CallToolResult): string {
	const first = result.content?.[0];
	if (!first || first.type !== "text") {
		throw new Error("Expected text content in tool result");
	}
	return first.text;
}

const readPayloadSchema = z.object({
	compression: z.object({
		mode: z.enum(["summary", "aggressive", "balanced", "none"]),
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
		"initialize" | "getAllDocuments" | "getDocumentInfo"
	> = {
		initialize: vi.fn(async () => {}),
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
	test("read action keeps full content when compressionMode is none", async () => {
		const vaultManager = createMockVaultManager();

		const result = await readSpecificFile(vaultManager, {
			action: "read",
			filename: "/vault/alpha.md",
			compressionMode: "none",
		});

		expect(result.isError).toBe(false);
		const payload = readPayloadSchema.parse(JSON.parse(firstText(result)));

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
		const payload = readPayloadSchema.parse(JSON.parse(firstText(result)));

		expect(payload.compression.mode).toBe("aggressive");
		expect(payload.compression.truncated).toBe(true);
		expect(payload.content.length).toBeLessThan(4000);
		expect(payload.backlinks.length).toBeLessThanOrEqual(
			READ_DEFAULT_BACKLINK_LIMIT.aggressive,
		);
	});
});
