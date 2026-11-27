import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { reindex } from "../../src/reindex.js";
import { ragIndexer } from "../../src/shared/indexing/RAGIndexer.js";
import { vectorDB } from "../../src/shared/indexing/VectorDB.js";
import { localEmbedder } from "../../src/shared/local-ai/Embedder.js";
import { localModelManager } from "../../src/shared/local-ai/LocalModelManager.js";

const tempDirs: string[] = [];

async function makeTempVault(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "reindex-cli-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	vi.restoreAllMocks();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

describe("reindex CLI command", () => {
	test("fails with models_missing when local embedder is not installed", async () => {
		const vaultDir = await makeTempVault();
		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(false);
		const resetSpy = vi.spyOn(vectorDB, "resetIndex");
		const indexAllSpy = vi.spyOn(ragIndexer, "indexAll");

		const result = await reindex({ vaultPath: vaultDir });

		expect(result).toEqual({
			success: false,
			mode: "incremental",
			totalFiles: 0,
			indexedFiles: 0,
			reason: "models_missing",
		});
		expect(resetSpy).not.toHaveBeenCalled();
		expect(indexAllSpy).not.toHaveBeenCalled();
	});

	test("resets index and runs full indexAll when force is true", async () => {
		const vaultDir = await makeTempVault();
		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(true);
		vi.spyOn(localModelManager, "holdModels").mockImplementation((task) =>
			task(),
		);
		const resetSpy = vi
			.spyOn(vectorDB, "resetIndex")
			.mockResolvedValue(undefined);
		const indexAllSpy = vi.spyOn(ragIndexer, "indexAll").mockResolvedValue(4);
		const createIndexSpy = vi
			.spyOn(vectorDB, "createVectorIndex")
			.mockResolvedValue(undefined);
		const shutdownSpy = vi
			.spyOn(ragIndexer, "shutdown")
			.mockResolvedValue(undefined);

		const result = await reindex({ vaultPath: vaultDir, force: true });

		expect(result).toEqual({
			success: true,
			mode: "force",
			totalFiles: 4,
			indexedFiles: 4,
		});
		expect(resetSpy).toHaveBeenCalledTimes(1);
		expect(indexAllSpy).toHaveBeenCalledWith(vaultDir);
		expect(createIndexSpy).toHaveBeenCalledTimes(1);
		expect(shutdownSpy).toHaveBeenCalledTimes(1);
	});

	test("runs full indexAll when schema migration occurs", async () => {
		const vaultDir = await makeTempVault();
		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(true);
		vi.spyOn(localModelManager, "holdModels").mockImplementation((task) =>
			task(),
		);
		vi.spyOn(vectorDB, "checkAndMigrateIfNeeded").mockResolvedValue(true);
		const indexAllSpy = vi.spyOn(ragIndexer, "indexAll").mockResolvedValue(3);
		const createIndexSpy = vi
			.spyOn(vectorDB, "createVectorIndex")
			.mockResolvedValue(undefined);
		vi.spyOn(ragIndexer, "shutdown").mockResolvedValue(undefined);

		const result = await reindex({ vaultPath: vaultDir });

		expect(result).toEqual({
			success: true,
			mode: "migrated",
			totalFiles: 3,
			indexedFiles: 3,
		});
		expect(indexAllSpy).toHaveBeenCalledWith(vaultDir);
		expect(createIndexSpy).toHaveBeenCalledTimes(1);
	});

	test("indexes only stale or missing markdown files in incremental mode", async () => {
		const vaultDir = await makeTempVault();
		const freshFile = join(vaultDir, "fresh.md");
		const staleFile = join(vaultDir, "stale.md");
		await writeFile(freshFile, "# Fresh", "utf-8");
		await writeFile(staleFile, "# Stale", "utf-8");
		const freshMtime = (await stat(freshFile)).mtime.toISOString();

		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(true);
		vi.spyOn(localModelManager, "holdModels").mockImplementation((task) =>
			task(),
		);
		vi.spyOn(vectorDB, "checkAndMigrateIfNeeded").mockResolvedValue(false);
		vi.spyOn(vectorDB, "getFileMtime").mockImplementation(async (filePath) =>
			filePath === freshFile ? freshMtime : null,
		);
		const indexFilesSpy = vi
			.spyOn(ragIndexer, "indexFiles")
			.mockResolvedValue(1);
		const createIndexSpy = vi
			.spyOn(vectorDB, "createVectorIndex")
			.mockResolvedValue(undefined);
		vi.spyOn(ragIndexer, "shutdown").mockResolvedValue(undefined);

		const result = await reindex({ vaultPath: vaultDir });

		expect(result).toEqual({
			success: true,
			mode: "incremental",
			totalFiles: 2,
			indexedFiles: 1,
		});
		expect(indexFilesSpy).toHaveBeenCalledWith([staleFile]);
		expect(createIndexSpy).toHaveBeenCalledTimes(1);
	});

	test("skips indexing when all files are already up to date", async () => {
		const vaultDir = await makeTempVault();
		const notePath = join(vaultDir, "note.md");
		await writeFile(notePath, "# Note", "utf-8");
		const noteMtime = (await stat(notePath)).mtime.toISOString();

		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(true);
		vi.spyOn(localModelManager, "holdModels").mockImplementation((task) =>
			task(),
		);
		vi.spyOn(vectorDB, "checkAndMigrateIfNeeded").mockResolvedValue(false);
		vi.spyOn(vectorDB, "getFileMtime").mockResolvedValue(noteMtime);
		const indexFilesSpy = vi.spyOn(ragIndexer, "indexFiles");
		const createIndexSpy = vi.spyOn(vectorDB, "createVectorIndex");
		vi.spyOn(ragIndexer, "shutdown").mockResolvedValue(undefined);

		const result = await reindex({ vaultPath: vaultDir });

		expect(result).toEqual({
			success: true,
			mode: "incremental",
			totalFiles: 1,
			indexedFiles: 0,
		});
		expect(indexFilesSpy).not.toHaveBeenCalled();
		expect(createIndexSpy).not.toHaveBeenCalled();
	});
});
