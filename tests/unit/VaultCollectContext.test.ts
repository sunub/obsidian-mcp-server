import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, test, vi } from "vitest";
import type { DocumentIndex } from "../../src/shared/markdown/types.js";
import type { SearchStatus } from "../../src/shared/searchStatus.js";
import type { EnrichedDocument } from "../../src/shared/vault-manager/types.js";
import type { VaultManager } from "../../src/shared/vault-manager/VaultManager.js";
import { obsidianContentQueryParamsZod } from "../../src/tools/vault/params.js";
import { collectContextResponseDataSchema } from "../../src/tools/vault/types/collect_context.js";
import { collectContext } from "../../src/tools/vault/utils.js";

function firstText(result: CallToolResult): string {
	const first = result.content?.[0];
	if (!first || first.type !== "text") {
		throw new Error("Expected text content in tool result");
	}
	return first.text;
}

function createMockVaultManager(
	variant = "v1",
	searchStatus: SearchStatus = { mode: "hybrid" },
) {
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

	const writeRawDocument = vi.fn(async (_path: string, _content: string) => {});

	const manager = {
		initialize: vi.fn(async () => {}),
		getAllDocuments: vi.fn(async () => docs),
		hybridSearch: vi.fn(async (query: string, limit = 5) => ({
			results: docs
				.filter((doc) =>
					doc.frontmatter.title?.toLowerCase().includes(query.toLowerCase()),
				)
				.slice(0, limit)
				.map((document, index) => ({
					score: 1 / (index + 1),
					finalScore: 1 / (index + 1),
					document,
					matchedChunks: [{ content: `matched in ${document.filePath}` }],
				})),
			search_status: searchStatus,
		})),
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
	test("keeps hybrid search ranking for topic scope", async () => {
		const { vaultManager } = createMockVaultManager("ranking-v1");

		const result = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 2,
			maxCharsPerDoc: 300,
			compressionMode: "none",
		});
		const payload = collectContextResponseDataSchema.parse(
			JSON.parse(firstText(result)),
		);

		expect(payload.documents.map((doc) => doc.fullPath)).toEqual([
			"/vault/nextjs-project.md",
			"/vault/nextjs-performance.md",
		]);
		expect(payload.matched_total).toBe(2);
	});

	test("puts ranked documents first for all scope with a topic", async () => {
		const { vaultManager } = createMockVaultManager("all-scope-v1");

		const result = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "project",
			scope: "all",
			maxDocs: 2,
			maxCharsPerDoc: 300,
			compressionMode: "none",
		});
		const payload = collectContextResponseDataSchema.parse(
			JSON.parse(firstText(result)),
		);

		expect(payload.documents.map((doc) => doc.fullPath)).toEqual([
			"/vault/nextjs-project.md",
			"/vault/nextjs-performance.md",
		]);
		expect(payload.matched_total).toBe(2);
	});

	test("reports the current search status inside the JSON payload", async () => {
		const request = {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 1,
			maxCharsPerDoc: 300,
		} as const;
		const degraded: SearchStatus = {
			mode: "keyword",
			reason: "semantic_unavailable",
		};

		const first = await collectContext(
			createMockVaultManager("status-v1", degraded).vaultManager,
			request,
		);
		const second = await collectContext(
			createMockVaultManager("status-v1").vaultManager,
			request,
		);

		expect(first.content).toHaveLength(1);
		expect(JSON.parse(firstText(first)).search_status).toEqual(degraded);
		expect(JSON.parse(firstText(second)).search_status).toEqual({
			mode: "hybrid",
		});
	});

	test("returns what the search found without judging it", async () => {
		const { vaultManager } = createMockVaultManager("facts-v1");

		const result = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 2,
			maxCharsPerDoc: 300,
			compressionMode: "none",
		});
		const raw = JSON.parse(firstText(result));

		expect(raw).not.toHaveProperty("memory_packet");
		for (const field of ["summary", "relevance", "evidence_snippets"]) {
			expect(raw.documents[0]).not.toHaveProperty(field);
		}
		expect(raw.documents[0]).toMatchObject({
			rank: 1,
			score: 1,
			matched_snippets: ["matched in /vault/nextjs-project.md"],
		});
		expect(raw.documents[1]).toMatchObject({ rank: 2, score: 0.5 });
	});

	test("marks documents the search did not match for all scope", async () => {
		const { vaultManager } = createMockVaultManager("unmatched-v1");

		const result = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "project",
			scope: "all",
			maxDocs: 2,
			maxCharsPerDoc: 300,
			compressionMode: "none",
		});
		const payload = collectContextResponseDataSchema.parse(
			JSON.parse(firstText(result)),
		);

		expect(payload.documents[1]).toMatchObject({
			rank: null,
			score: null,
			matched_snippets: [],
		});
	});

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
			JSON.parse(firstText(result)),
		);

		expect(payload.action).toBe("collect_context");
		expect(payload.documents).toHaveLength(1);
		expect(payload.batch.has_more).toBe(true);
		expect(typeof payload.batch.continuation_token).toBe("string");
		expect(payload.compression.estimated_tokens).toBeGreaterThan(0);
		expect(payload.cache?.hit).toBe(false);
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
			JSON.parse(firstText(first)),
		);
		const token = firstPayload.batch.continuation_token as string;

		const second = await collectContext(vaultManager, {
			action: "collect_context",
			continuationToken: token,
		});
		const secondPayload = collectContextResponseDataSchema.parse(
			JSON.parse(firstText(second)),
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

	test("collect_context는 Vault에 파일을 쓰지 않는다", async () => {
		const { vaultManager, writeRawDocument } = createMockVaultManager();
		const result = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 1,
			maxCharsPerDoc: 300,
		});

		expect(result.isError).toBe(false);
		expect(writeRawDocument).not.toHaveBeenCalled();
		const payload = JSON.parse(firstText(result));
		expect(payload).not.toHaveProperty("memory_mode");
		expect(payload).not.toHaveProperty("memory_write");
	});

	test("memoryMode 파라미터는 거부된다", () => {
		const result = obsidianContentQueryParamsZod.safeParse({
			action: "collect_context",
			topic: "x",
			memoryMode: "vault_note",
		});

		expect(result.success).toBe(false);
	});

	test("load_memory 액션은 거부된다", () => {
		const result = obsidianContentQueryParamsZod.safeParse({
			action: "load_memory",
		});

		expect(result.success).toBe(false);
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
			JSON.parse(firstText(first)),
		);

		const second = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "next.js",
			scope: "topic",
			maxDocs: 1,
			maxCharsPerDoc: 300,
		});
		const secondPayload = collectContextResponseDataSchema.parse(
			JSON.parse(firstText(second)),
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
			JSON.parse(firstText(initial)),
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
			JSON.parse(firstText(changed)),
		);

		expect(changedPayload.cache?.hit).toBe(false);
		expect(changedPayload.cache?.doc_hash).not.toBe(
			initialPayload.cache?.doc_hash,
		);
	});

	test("returns no documents and caches no-match collect_context results", async () => {
		const { vaultManager } = createMockVaultManager("no-match-v1");

		const first = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "rust",
			scope: "topic",
			maxDocs: 5,
			maxCharsPerDoc: 300,
		});
		const firstPayload = collectContextResponseDataSchema.parse(
			JSON.parse(firstText(first)),
		);

		const second = await collectContext(vaultManager, {
			action: "collect_context",
			topic: "rust",
			scope: "topic",
			maxDocs: 5,
			maxCharsPerDoc: 300,
		});
		const secondPayload = collectContextResponseDataSchema.parse(
			JSON.parse(firstText(second)),
		);

		expect(first.isError).toBe(false);
		expect(firstPayload.documents).toHaveLength(0);
		expect(firstPayload.matched_total).toBe(0);
		expect(firstPayload.batch.has_more).toBe(false);
		expect(firstPayload.batch.continuation_token).toBeNull();
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
			JSON.parse(firstText(result)),
		);

		expect(payload.compression.truncated).toBe(true);
		expect(payload.documents.length).toBeGreaterThan(0);
		expect(payload.documents.length).toBeLessThanOrEqual(1);
		expect(payload.batch.has_more).toBe(true);
		expect(typeof payload.batch.continuation_token).toBe("string");
		expect(payload.documents[0].backlinks_count).toBeLessThan(8);
		expect(payload.documents[0].truncated).toBe(true);
	});
});
