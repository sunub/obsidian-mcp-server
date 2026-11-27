import { afterEach, describe, expect, test, vi } from "vitest";
import { localEmbedder } from "../../src/shared/local-ai/Embedder.js";
import { localReranker } from "../../src/shared/local-ai/LocalReranker.js";
import { SEARCH_SETUP_COMMAND } from "../../src/shared/searchStatus.js";
import type { VaultManager } from "../../src/shared/vault-manager/VaultManager.js";
import { obsidianContentQueryParamsZod } from "../../src/tools/vault/params.js";
import { statsAllDocuments } from "../../src/tools/vault/utils/actions/stats.js";

function createFakeVaultManager(): VaultManager {
	return {
		initialize: vi.fn(async () => undefined),
		getStats: vi.fn(() => ({
			totalFiles: 12,
			isInitialized: true,
			vaultPath: "/tmp/vault",
			ragStatus: {
				isIndexing: false,
				processed: 0,
				total: 0,
				progress: 0,
			},
		})),
	} as unknown as VaultManager;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("vault stats action and removed MCP reindex action", () => {
	test("includes localModels and omits setupCommand when both models are ready", async () => {
		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(true);
		vi.spyOn(localReranker, "checkModelPresence").mockResolvedValue(true);

		const result = await statsAllDocuments(createFakeVaultManager());
		expect(result.isError).toBe(false);

		const text = (result.content[0] as { text: string }).text;
		const payload = JSON.parse(text);
		expect(payload.totalFiles).toBe(12);
		expect(payload.localModels).toEqual({
			embedderReady: true,
			rerankerReady: true,
		});
		expect(payload.setupCommand).toBeUndefined();
	});

	test("includes setupCommand when either local model is missing", async () => {
		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(false);
		vi.spyOn(localReranker, "checkModelPresence").mockResolvedValue(true);

		const result = await statsAllDocuments(createFakeVaultManager());
		const text = (result.content[0] as { text: string }).text;
		const payload = JSON.parse(text);

		expect(payload.localModels).toEqual({
			embedderReady: false,
			rerankerReady: true,
		});
		expect(payload.setupCommand).toBe(SEARCH_SETUP_COMMAND);
	});

	test("rejects deprecated index_vault_to_vectordb action in vault params", () => {
		const parsed = obsidianContentQueryParamsZod.safeParse({
			action: "index_vault_to_vectordb",
		});
		expect(parsed.success).toBe(false);
	});
});
