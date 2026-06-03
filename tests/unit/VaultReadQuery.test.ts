import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { readSpecificFile } from "../../src/tools/vault/utils.js";
import type { DocumentIndex } from "../../src/utils/processor/types.js";
import type { EnrichedDocument } from "../../src/utils/VaultManger/types.js";
import type { VaultManager } from "../../src/utils/VaultManger/VaultManager.js";

vi.mock("@/utils/LocalReranker.js", () => {
	return {
		localReranker: {
			rerank: vi.fn(async (query: string, documents: string[]) => {
				return documents
					.map((doc) => ({
						document: doc,
						score: doc.includes(query) ? 0.99 : 0.1,
					}))
					.sort((a, b) => b.score - a.score);
			}),
		},
	};
});

function firstText(result: CallToolResult): string {
	const first = result.content?.[0];
	if (!first || first.type !== "text") {
		throw new Error("Expected text content in tool result");
	}
	return first.text;
}

function createMockVaultManager(content: string) {
	const indexedDoc: DocumentIndex = {
		filePath: "/vault/beta.md",
		frontmatter: { title: "Beta", tags: ["test"] },
		contentLength: content.length,
		imageLinks: [],
		documentLinks: [],
	};

	const enrichedDoc: EnrichedDocument = {
		...indexedDoc,
		content,
		stats: {
			wordCount: 100,
			lineCount: 10,
			characterCount: content.length,
			contentLength: content.length,
			hasContent: true,
		},
		backlinks: [],
	};

	const manager = {
		initialize: vi.fn(async () => {}),
		getDocumentInfo: vi.fn(
			async (filename: string): Promise<EnrichedDocument | null> => {
				if (filename !== "/vault/beta.md" && filename !== "beta.md") {
					return null;
				}
				return enrichedDoc;
			},
		),
	};

	return manager as unknown as VaultManager;
}

describe("Vault read action with query filtering", () => {
	test("filters paragraphs using localReranker and preserves original order", async () => {
		const documentContent = [
			"This is paragraph one about apple.",
			"This is paragraph two about banana.",
			"This is paragraph three about orange.",
			"This is paragraph four about apple again.",
		].join("\n\n");

		const vaultManager = createMockVaultManager(documentContent);

		const result = await readSpecificFile(vaultManager, {
			action: "read",
			filename: "/vault/beta.md",
			query: "apple",
		});

		expect(result.isError).toBe(false);
		const payload = JSON.parse(firstText(result));

		expect(payload.content).toContain("This is paragraph one about apple.");
		expect(payload.content).toContain(
			"This is paragraph four about apple again.",
		);
		expect(payload.content).not.toContain(
			"This is paragraph three about orange.",
		);

		const indexOne = payload.content.indexOf("paragraph one");
		const indexFour = payload.content.indexOf("paragraph four");
		expect(indexOne).toBeLessThan(indexFour);
	});
});
