import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	type ChunkMetadata,
	vectorDB,
} from "../../src/shared/indexing/VectorDB";
import { localEmbedder } from "../../src/shared/local-ai/Embedder";
import { localModelManager } from "../../src/shared/local-ai/LocalModelManager";
import { VaultManager } from "../../src/shared/vault-manager/VaultManager";

let tempDir: string | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	}
});

async function writeVault(files: Record<string, string>): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "embedded-search-backend-"));
	for (const [name, body] of Object.entries(files)) {
		await writeFile(join(tempDir, name), body, "utf-8");
	}
	return tempDir;
}

function vectorChunk(
	dir: string,
	name: string,
	distance: number,
	chunkIndex = 0,
): ChunkMetadata & { _distance: number; vector: number[] } {
	return {
		id: `${name}_chunk_${chunkIndex}`,
		filePath: join(dir, name),
		fileName: name,
		chunkIndex,
		content: `${name} ${chunkIndex}`,
		_distance: distance,
		vector: [],
		metadata: {
			title: name,
			date: "",
			tags: "",
			summary: "",
			slug: "",
			category: "any",
			completed: false,
		},
	};
}

function stubSemanticSearch(
	chunks: Awaited<ReturnType<typeof vectorDB.search>>,
	{ modelPresent = true, warmedUp = true } = {},
) {
	vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(modelPresent);
	vi.spyOn(localModelManager, "withEmbedder").mockImplementation(
		async (_deadline, callback) => callback(warmedUp),
	);
	vi.spyOn(localEmbedder, "embed").mockResolvedValue(new Array(384).fill(0.1));
	vi.spyOn(vectorDB, "search").mockResolvedValue(chunks);
}

describe("embedded search", () => {
	test("키워드 일치가 없고 최고 유사도가 0.85이면 결과에 low_confidence를 표시한다", async () => {
		const dir = await writeVault({ "a.md": "serverless" });
		stubSemanticSearch([vectorChunk(dir, "a.md", 0.15)]);

		const response = await new VaultManager(dir).hybridSearch("quantum", 5);

		expect(response.results.map((r) => r.document.filePath)).toEqual([
			join(dir, "a.md"),
		]);
		expect(response.search_status).toEqual({
			mode: "hybrid",
			reason: "low_confidence",
		});
	});

	test("키워드 일치가 없어도 유사도가 0.91이면 Dense 결과를 돌려준다", async () => {
		const dir = await writeVault({ "a.md": "serverless" });
		stubSemanticSearch([vectorChunk(dir, "a.md", 0.09)]);

		const response = await new VaultManager(dir).hybridSearch("quantum", 5);

		expect(response.results.map((r) => r.document.filePath)).toEqual([
			join(dir, "a.md"),
		]);
		expect(response.search_status).toEqual({ mode: "hybrid" });
	});

	test("키워드가 일치하면 유사도가 낮아도 결과를 돌려준다", async () => {
		const dir = await writeVault({ "a.md": "serverless" });
		stubSemanticSearch([vectorChunk(dir, "a.md", 0.3)]);

		const response = await new VaultManager(dir).hybridSearch("serverless", 5);

		expect(response.results).toHaveLength(1);
		expect(response.search_status).toEqual({ mode: "hybrid" });
	});

	test.each([
		["models_missing", { modelPresent: false }],
		["semantic_unavailable", { warmedUp: false }],
	])("%s 폴백에서는 low_confidence를 표시하지 않는다", async (reason, options) => {
		const dir = await writeVault({ "a.md": "serverless" });
		stubSemanticSearch([], options);

		const response = await new VaultManager(dir).hybridSearch("quantum", 5);

		expect(response.results).toEqual([]);
		expect(response.search_status.mode).toBe("keyword");
		expect(response.search_status.reason).toBe(reason);
	});

	test("키워드와 Dense를 합친 문서 순서와 matchedChunks를 유지한다", async () => {
		const filler = "무관한 문장입니다. ".repeat(80);
		const dir = await writeVault({
			"both.md": "serverless",
			"dense.md": "unrelated",
			"keyword.md": "serverless 짧은 메모",
			"weak.md": `serverless ${filler}`,
		});
		stubSemanticSearch([
			vectorChunk(dir, "dense.md", 0.05, 0),
			vectorChunk(dir, "both.md", 0.06, 0),
			vectorChunk(dir, "dense.md", 0.07, 1),
		]);

		const response = await new VaultManager(dir).hybridSearch("serverless", 5);

		expect(
			response.results.map((r) => [
				r.document.filePath,
				r.matchedChunks.map((c) => c.content),
			]),
		).toEqual([
			[join(dir, "both.md"), ["both.md 0"]],
			[join(dir, "dense.md"), ["dense.md 0", "dense.md 1"]],
			[join(dir, "keyword.md"), ["serverless 짧은 메모"]],
		]);
	});
});
