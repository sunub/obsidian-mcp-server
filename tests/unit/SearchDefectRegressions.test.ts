import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import state from "../../src/config";
import { reindex } from "../../src/reindex";
import { ChunkBM25Index } from "../../src/shared/indexing/keyword-search/index";
import { ragIndexer } from "../../src/shared/indexing/RAGIndexer";
import {
	INDEX_VERSION,
	VectorDB,
	vectorDB,
} from "../../src/shared/indexing/VectorDB";
import { localEmbedder } from "../../src/shared/local-ai/Embedder";
import { localModelManager } from "../../src/shared/local-ai/LocalModelManager";
import { VaultManager } from "../../src/shared/vault-manager/VaultManager";

const tempDirs: string[] = [];
const originalVaultPath = state.vaultPath;

afterEach(async () => {
	vi.restoreAllMocks();
	state.vaultPath = originalVaultPath;
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

async function createTempVault(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "search-defect-regression-"));
	tempDirs.push(dir);
	return dir;
}

describe("Production search defect regressions", () => {
	test("hybridSearch stays enabled when the embedder model exists", async () => {
		const dir = await createTempVault();
		const notePath = join(dir, "guide.md");
		await writeFile(
			notePath,
			"# Guide\n\nHybrid search architecture.",
			"utf-8",
		);

		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(true);
		vi.spyOn(localModelManager, "withEmbedder").mockImplementation(
			async (_deadline, cb) => cb(true),
		);
		vi.spyOn(localEmbedder, "embed").mockResolvedValue(
			new Array(384).fill(0.1),
		);
		vi.spyOn(vectorDB, "search").mockResolvedValue([
			{
				id: `${notePath}_chunk_0`,
				filePath: notePath,
				fileName: "guide.md",
				chunkIndex: 0,
				content: "Hybrid search architecture.",
				_distance: 0.1,
				vector: [],
				metadata: {
					title: "Guide",
					date: "",
					tags: "",
					summary: "",
					slug: "",
					category: "any",
					completed: false,
				},
			},
		]);

		const manager = new VaultManager(dir);
		const response = await manager.hybridSearch("architecture", 5);

		expect(response.search_status.mode).toBe("hybrid");
		expect(response.results[0]?.document.filePath).toBe(notePath);
	});

	test("upsertDocument still updates RAG index when embedder is idle", async () => {
		const dir = await createTempVault();
		const notePath = join(dir, "live-edit.md");
		await writeFile(notePath, "# Live\n\nInitial content.", "utf-8");

		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(true);
		const processFileSpy = vi
			.spyOn(ragIndexer, "processFile")
			.mockResolvedValue(undefined);

		const manager = new VaultManager(dir);
		await manager.initialize();
		expect(localModelManager.isEmbedderReady).toBe(false);

		await manager.upsertDocument(notePath);

		expect(processFileSpy).toHaveBeenCalledWith(notePath);
	});

	test("VectorDB.search returns empty array when stored index_version mismatches INDEX_VERSION", async () => {
		const dir = await createTempVault();
		state.vaultPath = dir;

		const db = new VectorDB();
		const conn = await db.connect();
		await conn.createTable(
			"obsidian_meta",
			[{ key: "index_version", value: String(INDEX_VERSION - 1) }],
			{ mode: "overwrite" },
		);
		await db.upsertChunks([
			{
				id: "stale_0",
				filePath: join(dir, "stale.md"),
				fileName: "stale.md",
				chunkIndex: 0,
				content: "stale content",
				vector: new Array(384).fill(0.1),
				metadata: {
					title: "Stale",
					date: "",
					tags: "",
					summary: "",
					slug: "",
					category: "any",
					completed: false,
				},
			},
		]);

		const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const results = await db.search(new Array(384).fill(0.1), 5);

		expect(results).toEqual([]);
		expect(warnSpy).toHaveBeenCalled();
	});

	test("reindex migrates schema, indexes all files, and builds vector index in order", async () => {
		const dir = await createTempVault();
		const calls: string[] = [];

		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(true);
		vi.spyOn(localModelManager, "holdModels").mockImplementation((task) =>
			task(),
		);
		vi.spyOn(vectorDB, "checkAndMigrateIfNeeded").mockImplementation(
			async () => {
				calls.push("migrate");
				return true;
			},
		);
		vi.spyOn(ragIndexer, "indexAll").mockImplementation(async () => {
			calls.push("indexAll");
			return 0;
		});
		vi.spyOn(vectorDB, "createVectorIndex").mockImplementation(async () => {
			calls.push("createIndex");
		});
		vi.spyOn(ragIndexer, "shutdown").mockResolvedValue(undefined);

		await reindex({ vaultPath: dir });

		expect(calls).toEqual(["migrate", "indexAll", "createIndex"]);
	});

	test("ChunkBM25Index normalizes NFD Korean and splits hyphenated and Windows filenames", () => {
		const index = new ChunkBM25Index();
		const nfdPath = `docs/${"회의록".normalize("NFD")}-2026.md`;
		const winPath = "C:\\vault\\notes\\deploy-guide.md";

		index.addDocument({
			filePath: nfdPath,
			title: "",
			tags: [],
			body: "주간 안건",
		});
		index.addDocument({
			filePath: winPath,
			title: "",
			tags: [],
			body: "릴리즈 체크리스트",
		});

		expect(index.search("회의록").map((h) => h.filePath)).toEqual([nfdPath]);
		expect(index.search("deploy").map((h) => h.filePath)).toEqual([winPath]);
		expect(index.search("deploy-guide").map((h) => h.filePath)).toEqual([
			winPath,
		]);
	});
});
