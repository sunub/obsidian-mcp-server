import { describe, expect, test, vi } from "vitest";
import { collectContextResponseDataSchema } from "../../src/tools/vault/types/collect_context";
import { collectContext } from "../../src/tools/vault/utils";
import type { DocumentIndex } from "../../src/utils/processor/types";
import type { EnrichedDocument } from "../../src/utils/VaultManger/types";
import type { VaultManager } from "../../src/utils/VaultManger/VaultManager";

function createMockVaultManager(variant = "v1") {
	const docs: DocumentIndex[] = [
		{
			filePath: "/vault/nextjs-project.md",
			frontmatter: { title: "Next.js Project", tags: ["next.js", "frontend"] },
			contentLength: 2400,
			imageLinks: [],
			documentLinks: [],
		},
		{
			filePath: "/vault/nextjs-performance.md",
			frontmatter: { title: "Next.js Performance", tags: ["next.js", "perf"] },
			contentLength: 2100,
			imageLinks: [],
			documentLinks: [],
		},
	];

	const enrichedDocs: Record<string, EnrichedDocument> = {
		"/vault/nextjs-project.md": {
			...docs[0],
			content: `---\ntitle: Next.js Project\n---\nBuilt SSR dashboard with Next.js and optimized page load. - Improved Lighthouse score from 68 to 92. ${variant}`,
			stats: {
				wordCount: 120,
				lineCount: 20,
				characterCount: 2400,
				contentLength: 2400,
				hasContent: true,
			},
			backlinks: Array.from({ length: 8 }).map((_, i) => ({
				filePath: `/vault/resume-${i}.md`,
				title: `Resume ${i}`,
			})),
		},
		"/vault/nextjs-performance.md": {
			...docs[1],
			content: `---\ntitle: Next.js Performance\n---\nUsed dynamic import and image optimization in production. - Reduced TTI by 35% for key landing pages. ${variant}`,
			stats: {
				wordCount: 110,
				lineCount: 18,
				characterCount: 2100,
				contentLength: 2100,
				hasContent: true,
			},
			backlinks: Array.from({ length: 7 }).map((_, i) => ({
				filePath: `/vault/portfolio-${i}.md`,
				title: `Portfolio ${i}`,
			})),
		},
	};

	const writeRawDocument = vi.fn(async () => {});

	const manager = {
		initialize: vi.fn(async () => {}),
		getAllDocuments: vi.fn(async () => docs),
		searchDocuments: vi.fn(async (keyword: string) =>
			docs.filter((doc) =>
				doc.frontmatter.title?.toLowerCase().includes(keyword.toLowerCase()),
			),
		),
		getDocumentInfo: vi.fn(
			async (
				filename: string,
				options?: { maxContentPreview?: number },
			): Promise<EnrichedDocument | null> => {
				const matched = enrichedDocs[filename];
				if (!matched) {
					return null;
				}
				if (!options?.maxContentPreview) {
					return matched;
				}
				return {
					...matched,
					content: matched.content.substring(0, options.maxContentPreview),
				};
			},
		),
		writeRawDocument,
	};

	return {
		vaultManager: manager as unknown as VaultManager,
		writeRawDocument,
	};
}

describe("Vault collect_context orchestration", () => {
	test("returns continuation token for batched collect_context", async () => {
		const { vaultManager } = createMockVaultManager();

		const result = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 1,
			maxCharsPerDoc: 300,
		});

		expect(result.isError).toBe(false);
		const payload = collectContextResponseDataSchema.parse(
			JSON.parse(String(result.content?.[0].text)),
		);

		expect(payload.action).toBe("collect_context");
		expect(payload.documents).toHaveLength(1);
		expect(payload.batch.has_more).toBe(true);
		expect(typeof payload.batch.continuation_token).toBe("string");
		expect(payload.memory_packet.keyFacts.length).toBeGreaterThan(0);
		expect(payload.compression.estimated_tokens).toBeGreaterThan(0);
		expect(payload.cache.hit).toBe(false);
	});

	test("can resume collect_context with continuationToken", async () => {
		const { vaultManager } = createMockVaultManager();

		const first = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 1,
			maxCharsPerDoc: 300,
		});
		const firstPayload = collectContextResponseDataSchema.parse(
			JSON.parse(String(first.content?.[0].text)),
		);
		const token = firstPayload.batch.continuation_token as string;

		const second = await collectContext(vaultManager, {
			action: "collect_context",
			continuationToken: token,
		});
		const secondPayload = collectContextResponseDataSchema.parse(
			JSON.parse(String(second.content?.[0].text)),
		);

		expect(second.isError).toBe(false);
		expect(secondPayload.batch.start_cursor).toBeGreaterThan(0);
		expect(secondPayload.documents).toHaveLength(1);
		expect(secondPayload.batch.has_more).toBe(false);
		expect(secondPayload.documents[0].fullPath).not.toBe(
			firstPayload.documents[0].fullPath,
		);
	});

	test("returns error when continuation token is invalid", async () => {
		const { vaultManager } = createMockVaultManager();
		const result = await collectContext(vaultManager, {
			action: "collect_context",
			continuationToken: "invalid-token",
		});

		expect(result.isError).toBe(true);
	});

	test("writes memory note when memoryMode is both", async () => {
		const { vaultManager, writeRawDocument } = createMockVaultManager();
		const result = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 1,
			maxCharsPerDoc: 300,
			memoryMode: "both",
		});

		expect(result.isError).toBe(false);
		const payload = collectContextResponseDataSchema.parse(
			JSON.parse(String(result.content?.[0].text)),
		);

		expect(writeRawDocument).toHaveBeenCalledTimes(1);
		expect(writeRawDocument).toHaveBeenCalledWith(
			"memory/resume_context.v1.md",
			expect.stringContaining("# Resume Context v1"),
		);
		expect(writeRawDocument.mock.calls[0][1]).toContain(
			'"schema_version": "resume_context.v1"',
		);
		expect(payload.memory_write.status).toBe("written");
		expect(payload.memory_write.generated_at).toBeDefined();
		expect(payload.memory_write.source_hash).toMatch(/^[a-f0-9]{64}$/);
	});

	test("uses cache for repeated collect_context requests", async () => {
		const { vaultManager } = createMockVaultManager("cache-v1");

		const first = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 1,
			maxCharsPerDoc: 300,
		});
		const firstPayload = collectContextResponseDataSchema.parse(
			JSON.parse(String(first.content?.[0].text)),
		);

		const second = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 1,
			maxCharsPerDoc: 300,
		});
		const secondPayload = collectContextResponseDataSchema.parse(
			JSON.parse(String(second.content?.[0].text)),
		);

		expect(firstPayload.cache?.hit).toBe(false);
		expect(secondPayload.cache?.hit).toBe(true);
		expect(firstPayload.cache?.doc_hash).toBe(secondPayload.cache?.doc_hash);
	});

	test("invalidates cache when document content changes", async () => {
		const { vaultManager: initialManager } =
			createMockVaultManager("invalidate-v1");
		const initial = await collectContext(initialManager, {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 1,
			maxCharsPerDoc: 300,
		});
		const initialPayload = collectContextResponseDataSchema.parse(
			JSON.parse(String(initial.content?.[0].text)),
		);

		const { vaultManager: changedManager } =
			createMockVaultManager("invalidate-v2");
		const changed = await collectContext(changedManager, {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 1,
			maxCharsPerDoc: 300,
		});
		const changedPayload = collectContextResponseDataSchema.parse(
			JSON.parse(String(changed.content?.[0].text)),
		);

		expect(changedPayload.cache?.hit).toBe(false);
		expect(changedPayload.cache?.doc_hash).not.toBe(
			initialPayload.cache?.doc_hash,
		);
	});

	test("returns empty packet and caches no-match collect_context results", async () => {
		const { vaultManager } = createMockVaultManager("no-match-v1");

		const first = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "rust",
			scope: "topic",
			maxDocs: 5,
			maxCharsPerDoc: 300,
		});
		const firstPayload = collectContextResponseDataSchema.parse(
			JSON.parse(String(first.content?.[0].text)),
		);

		const second = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "rust",
			scope: "topic",
			maxDocs: 5,
			maxCharsPerDoc: 300,
		});
		const secondPayload = collectContextResponseDataSchema.parse(
			JSON.parse(String(second.content?.[0].text)),
		);

		expect(first.isError).toBe(false);
		expect(firstPayload.documents).toHaveLength(0);
		expect(firstPayload.matched_total).toBe(0);
		expect(firstPayload.batch.has_more).toBe(false);
		expect(firstPayload.batch.continuation_token).toBeNull();
		expect(firstPayload.memory_packet.topicSummary).toContain(
			'No evidence was collected for topic "rust".',
		);
		expect(firstPayload.cache?.hit).toBe(false);
		expect(secondPayload.cache?.hit).toBe(true);
	});

	test("applies guardrails in tight output budgets and keeps continuation", async () => {
		const { vaultManager } = createMockVaultManager("guardrail-v1");
		const result = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 2,
			maxCharsPerDoc: 1200,
			maxOutputChars: 1400,
		});

		expect(result.isError).toBe(false);
		const payload = collectContextResponseDataSchema.parse(
			JSON.parse(String(result.content?.[0].text)),
		);

		expect(payload.compression.truncated).toBe(true);
		expect(payload.documents.length).toBeGreaterThan(0);
		expect(payload.documents.length).toBeLessThanOrEqual(1);
		expect(payload.batch.has_more).toBe(true);
		expect(typeof payload.batch.continuation_token).toBe("string");
		expect(payload.documents[0].backlinks_count).toBeLessThanOrEqual(3);
		expect(payload.documents[0].truncated).toBe(true);
	});
});
