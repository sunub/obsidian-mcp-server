import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ragIndexer } from "../../src/shared/indexing/RAGIndexer";
import { localEmbedder } from "../../src/shared/local-ai/Embedder";
import {
	LocalModelManager,
	localModelManager,
} from "../../src/shared/local-ai/LocalModelManager";
import { VaultManager } from "../../src/shared/vault-manager/VaultManager";

const tempDirs: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

describe("model disposal and background indexing", () => {
	test("ending a tool call keeps models loaded while a note is being indexed", async () => {
		const dir = await mkdtemp(join(tmpdir(), "rag-model-hold-"));
		tempDirs.push(dir);
		const notePath = join(dir, "note.md");
		await writeFile(notePath, "body", "utf-8");
		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(true);
		const disposeSpy = vi
			.spyOn(localEmbedder, "dispose")
			.mockResolvedValue(undefined);
		let finishIndexing: () => void = () => {};
		const processSpy = vi.spyOn(ragIndexer, "processFile").mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishIndexing = resolve;
				}),
		);
		const manager = new VaultManager(dir);
		await manager.initialize();

		localModelManager.beginToolCall();
		await manager.upsertDocument(notePath);
		await localModelManager.endToolCall();

		await vi.waitFor(() => expect(processSpy).toHaveBeenCalled());
		expect(disposeSpy).not.toHaveBeenCalled();
		finishIndexing();
	}, 1000);

	test("a model use that starts during disposal loads only after disposal ends", async () => {
		const events: string[] = [];
		let finishDispose: () => void = () => {};
		const embedder = {
			checkModelPresence: async () => true,
			init: async () => {
				events.push("init");
			},
			dispose: () =>
				new Promise<void>((resolve) => {
					finishDispose = () => {
						events.push("disposed");
						resolve();
					};
				}),
		};
		const manager = new LocalModelManager({ embedder });

		manager.beginToolCall();
		const disposal = manager.endToolCall();
		const use = manager.withEmbedder(500, async (ready) => {
			events.push(`use:${ready}`);
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		finishDispose();
		await Promise.all([disposal, use]);

		expect(events).toEqual(["disposed", "init", "use:true"]);
		const shutdown = manager.shutdown();
		finishDispose();
		await shutdown;
	}, 1000);
});
