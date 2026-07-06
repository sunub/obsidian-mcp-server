import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { localEmbedder } from "../../src/utils/Embedder";
import { localModelManager } from "../../src/utils/LocalModelManager";
import { localReranker } from "../../src/utils/LocalReranker";
import { VaultManager } from "../../src/utils/VaultManger/VaultManager";

let tempDir: string | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	}
});

describe("VaultManager semantic fallback", () => {
	test("hybridSearch returns keyword results when semantic warmup misses deadline", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "vault-semantic-fallback-"));
		await writeFile(
			join(tempDir, "alpha.md"),
			"# Alpha\n\nThis note is about durable MCP lifecycle cleanup.",
			"utf-8",
		);
		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(true);
		vi.spyOn(localReranker, "checkModelPresence").mockResolvedValue(true);
		vi.spyOn(localModelManager, "withEmbedder").mockImplementation(
			async (_softDeadlineMs, callback) => callback(false),
		);
		const embedSpy = vi.spyOn(localEmbedder, "embed");

		const manager = new VaultManager(tempDir);
		const result = await manager.hybridSearch("durable lifecycle", 5);

		expect(result.results).toHaveLength(1);
		expect(result.results[0]?.document.filePath.endsWith("alpha.md")).toBe(
			true,
		);
		expect(result.diagnostic_message).toContain("semantic 모델");
		expect(embedSpy).not.toHaveBeenCalled();
	});
});
