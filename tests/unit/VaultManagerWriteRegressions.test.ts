import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ragIndexer } from "../../src/shared/indexing/RAGIndexer";
import { localEmbedder } from "../../src/shared/local-ai/Embedder";
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

async function createTempVault(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "vault-write-regression-"));
	tempDirs.push(dir);
	return dir;
}

async function createReadyManager(dir: string): Promise<VaultManager> {
	vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(true);
	const manager = new VaultManager(dir);
	await manager.initialize();
	return manager;
}

function holdRagIndexing() {
	const releases: (() => void)[] = [];
	const spy = vi.spyOn(ragIndexer, "processFile").mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				releases.push(resolve);
			}),
	);
	return { spy, releaseNext: () => releases.shift()?.() };
}

describe("VaultManager background RAG indexing", () => {
	test("writeDocument resolves while RAG indexing is still running", async () => {
		const dir = await createTempVault();
		const notePath = join(dir, "note.md");
		await writeFile(notePath, "body", "utf-8");
		const manager = await createReadyManager(dir);
		const { spy, releaseNext } = holdRagIndexing();

		await manager.writeDocument("note.md", { done: true });

		expect(await readFile(notePath, "utf-8")).toContain("done: true");
		await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
		releaseNext();
	}, 1000);

	test("repeated requests during a run collapse into one follow-up run", async () => {
		const dir = await createTempVault();
		const notePath = join(dir, "note.md");
		await writeFile(notePath, "body", "utf-8");
		const manager = await createReadyManager(dir);
		const { spy, releaseNext } = holdRagIndexing();

		await manager.upsertDocument(notePath);
		await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
		await manager.upsertDocument(notePath);
		await manager.upsertDocument(notePath);
		await manager.upsertDocument(notePath);
		releaseNext();
		await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
		releaseNext();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(spy).toHaveBeenCalledTimes(2);
	}, 1000);

	test("removeDocument cancels a queued RAG run for that file", async () => {
		const dir = await createTempVault();
		const firstPath = join(dir, "first.md");
		const secondPath = join(dir, "second.md");
		await writeFile(firstPath, "first", "utf-8");
		await writeFile(secondPath, "second", "utf-8");
		const manager = await createReadyManager(dir);
		const { spy, releaseNext } = holdRagIndexing();
		const deleteSpy = vi
			.spyOn(ragIndexer, "deleteFile")
			.mockResolvedValue(undefined);

		await manager.upsertDocument(firstPath);
		await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
		await manager.upsertDocument(secondPath);
		const removal = manager.removeDocument(secondPath);
		releaseNext();
		await removal;
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(spy).toHaveBeenCalledTimes(1);
		expect(deleteSpy).toHaveBeenCalledWith(secondPath);
	}, 1000);
});

describe("VaultManager.writeDocument safety", () => {
	test("refuses to write when existing frontmatter is invalid YAML", async () => {
		const dir = await createTempVault();
		const notePath = join(dir, "broken.md");
		const original = "---\ntitle: a: b\n---\nbody\n";
		await writeFile(notePath, original, "utf-8");
		expect(() => matter(original)).toThrow();
		const manager = new VaultManager(dir);

		await expect(
			manager.writeDocument("broken.md", { done: true }),
		).rejects.toThrow();

		expect(await readFile(notePath, "utf-8")).toBe(original);
	});

	test("merges new properties into valid frontmatter and keeps the body", async () => {
		const dir = await createTempVault();
		const notePath = join(dir, "valid.md");
		await writeFile(notePath, "---\ntitle: Kept\n---\nbody\n", "utf-8");
		const manager = new VaultManager(dir);

		await manager.writeDocument("valid.md", { done: true });

		const written = matter(await readFile(notePath, "utf-8"), {});
		expect(written.data).toEqual({ title: "Kept", done: true });
		expect(written.content.trim()).toBe("body");
	});

	test("resolves a name without extension to the existing markdown file", async () => {
		const dir = await createTempVault();
		await writeFile(join(dir, "my-note.md"), "body", "utf-8");
		const manager = new VaultManager(dir);

		await manager.writeDocument("my-note", { done: true });

		expect(await readFile(join(dir, "my-note.md"), "utf-8")).toContain(
			"done: true",
		);
		expect(await readdir(dir)).not.toContain("my-note");
	});

	test("fails without creating a file when the target does not exist", async () => {
		const dir = await createTempVault();
		const manager = new VaultManager(dir);

		await expect(
			manager.writeDocument("missing.md", { done: true }),
		).rejects.toThrow();

		expect(await readdir(dir)).not.toContain("missing.md");
	});
});
