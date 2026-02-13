import { describe, expect, test, vi } from "vitest";
import { loadMemory } from "../../src/tools/vault/utils";
import type { EnrichedDocument } from "../../src/utils/VaultManger/types";
import type { VaultManager } from "../../src/utils/VaultManger/VaultManager";

function createMemoryNote(): EnrichedDocument {
	return {
		filePath: "/vault/memory/resume_context.v1.md",
		frontmatter: { title: "Resume Context v1" },
		contentLength: 1200,
		imageLinks: [],
		documentLinks: [],
		content: [
			"# Resume Context v1",
			"",
			"- generated_at: 2026-02-13T00:00:00.000Z",
			"- source_hash: 6f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f",
			"- schema_version: resume_context.v1",
			"",
			"## Topic Summary",
			"Built and optimized Next.js production workflows.",
			"",
			"## Canonical JSON",
			"```json",
			"{",
			'  "schema_version": "resume_context.v1",',
			'  "generated_at": "2026-02-13T00:00:00.000Z",',
			'  "source_hash": "6f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f",',
			'  "scope": "topic",',
			'  "topic": "next.js",',
			'  "documents": [',
			'    { "fullPath": "/vault/nextjs.md" }',
			"  ],",
			'  "memory_packet": {',
			'    "topicSummary": "Built and optimized Next.js production workflows.",',
			'    "keyFacts": ["Next.js SSR optimization shipped"],',
			'    "experienceBullets": ["Improved performance metrics in production"],',
			'    "sourceRefs": [',
			"      {",
			'        "filePath": "/vault/nextjs.md",',
			'        "title": "Next.js Note",',
			'        "relevance": "high",',
			'        "evidenceSnippets": ["Reduced TTI by 35%"]',
			"      }",
			"    ],",
			'    "openQuestions": [],',
			'    "confidence": 0.87',
			"  }",
			"}",
			"```",
			"",
		].join("\n"),
		stats: {
			wordCount: 160,
			lineCount: 40,
			characterCount: 1200,
			contentLength: 1200,
			hasContent: true,
		},
	};
}

function createStaleMemoryNote(): EnrichedDocument {
	return {
		filePath: "/vault/memory/resume_context.v1.md",
		frontmatter: { title: "Resume Context v0" },
		contentLength: 900,
		imageLinks: [],
		documentLinks: [],
		content: [
			"# Resume Context v0",
			"",
			"- generated_at: 2026-01-01T00:00:00.000Z",
			"- source_hash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"- schema_version: resume_context.v0",
			"",
			"## Canonical JSON",
			"```json",
			"{",
			'  "schema_version": "resume_context.v0",',
			'  "generated_at": "2026-01-01T00:00:00.000Z",',
			'  "source_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",',
			'  "scope": "topic",',
			'  "topic": "legacy",',
			'  "documents": [',
			'    { "fullPath": "/vault/legacy.md" }',
			"  ],",
			'  "memory_packet": {',
			'    "topicSummary": 123,',
			'    "keyFacts": "invalid",',
			'    "experienceBullets": [],',
			'    "sourceRefs": [],',
			'    "openQuestions": [],',
			'    "confidence": 1.2',
			"  }",
			"}",
			"```",
			"",
		].join("\n"),
		stats: {
			wordCount: 120,
			lineCount: 32,
			characterCount: 900,
			contentLength: 900,
			hasContent: true,
		},
	};
}

function createMockVaultManager(memoryNote: EnrichedDocument | null) {
	const manager = {
		initialize: vi.fn(async () => {}),
		getDocumentInfo: vi.fn(
			async (filename: string): Promise<EnrichedDocument | null> => {
				if (!memoryNote) {
					return null;
				}
				if (
					filename === "memory/resume_context.v1.md" ||
					filename === memoryNote.filePath
				) {
					return memoryNote;
				}
				return null;
			},
		),
	};

	return manager as unknown as VaultManager;
}

describe("Vault load_memory action", () => {
	test("loads canonical memory note and returns parsed packet", async () => {
		const vaultManager = createMockVaultManager(createMemoryNote());
		const result = await loadMemory(vaultManager, {
			action: "load_memory",
		});

		expect(result.isError).toBe(false);
		const payload = JSON.parse(String(result.content?.[0].text));

		expect(payload.action).toBe("load_memory");
		expect(payload.has_canonical_json).toBe(true);
		expect(payload.schema_version).toBe("resume_context.v1");
		expect(payload.topic).toBe("next.js");
		expect(payload.scope).toBe("topic");
		expect(payload.documents_count).toBe(1);
		expect(payload.memory_packet.topicSummary).toContain("Next.js");
		expect(payload.compression.estimated_tokens).toBeGreaterThan(0);
	});

	test("supports quiet mode for fast metadata-only load", async () => {
		const vaultManager = createMockVaultManager(createMemoryNote());
		const result = await loadMemory(vaultManager, {
			action: "load_memory",
			quiet: true,
		});

		expect(result.isError).toBe(false);
		const payload = JSON.parse(String(result.content?.[0].text));
		expect(payload.found).toBe(true);
		expect(payload.topic).toBe("next.js");
		expect(payload.scope).toBe("topic");
		expect(payload.schema_version).toBe("resume_context.v1");
	});

	test("returns error when memory note does not exist", async () => {
		const vaultManager = createMockVaultManager(null);
		const result = await loadMemory(vaultManager, {
			action: "load_memory",
		});

		expect(result.isError).toBe(true);
		const payload = JSON.parse(String(result.content?.[0].text));
		expect(payload.error).toContain("Memory note not found");
	});

	test("handles stale canonical schema with invalid memory packet safely", async () => {
		const vaultManager = createMockVaultManager(createStaleMemoryNote());
		const result = await loadMemory(vaultManager, {
			action: "load_memory",
		});

		expect(result.isError).toBe(false);
		const payload = JSON.parse(String(result.content?.[0].text));
		expect(payload.has_canonical_json).toBe(true);
		expect(payload.schema_version).toBe("resume_context.v0");
		expect(payload.memory_packet).toBeNull();
		expect(payload.documents_count).toBe(1);
		expect(payload.preview).toContain("Resume Context v0");
	});
});
