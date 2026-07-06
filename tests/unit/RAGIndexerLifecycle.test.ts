import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const runTask = vi.hoisted(() =>
	vi.fn(async ({ filePath }: { filePath: string }) => [
		{
			id: `${filePath}#0`,
			filePath,
			fileName: "note.md",
			chunkIndex: 0,
			content: "hello world",
			metadata: {
				title: "",
				date: "",
				tags: "",
				summary: "",
				slug: "",
				category: "",
				completed: false,
			},
		},
	]),
);
const withEmbedder = vi.hoisted(() =>
	vi.fn(async (_softDeadlineMs: number, callback: (ready: boolean) => Promise<unknown>) =>
		callback(false),
	),
);
const embedderInit = vi.hoisted(() => vi.fn(async () => undefined));
const embed = vi.hoisted(() => vi.fn(async () => [0.1, 0.2]));

vi.mock("../../src/utils/worker/WorkerPool.js", () => ({
	WorkerPool: class {
		init() {}
		terminateAll = vi.fn(async () => undefined);
		runTask = runTask;
	},
}));

vi.mock("../../src/utils/LocalModelManager.js", () => ({
	localModelManager: {
		withEmbedder,
	},
}));

vi.mock("../../src/utils/Embedder.js", () => ({
	localEmbedder: {
		init: embedderInit,
		getTokenCount: (text: string) => text.length,
		embed,
	},
}));

let tempDir: string | null = null;

afterEach(async () => {
	vi.clearAllMocks();
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	}
});

describe("RAGIndexer local model lifecycle", () => {
	test("uses LocalModelManager instead of directly initializing the embedder", async () => {
		const { RAGIndexer } = await import("../../src/utils/RAGIndexer.js");
		tempDir = await mkdtemp(join(tmpdir(), "rag-indexer-lifecycle-"));
		const filePath = join(tempDir, "note.md");
		await writeFile(filePath, "# Note\n\nhello world", "utf-8");

		const indexer = new RAGIndexer();
		const result = await indexer.processFileInMemory(filePath);

		expect(result).toBeNull();
		expect(withEmbedder).toHaveBeenCalledTimes(1);
		expect(embedderInit).not.toHaveBeenCalled();
		expect(embed).not.toHaveBeenCalled();
	});
});
