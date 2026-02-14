import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import {
	CONTEXT_MEMORY_SNAPSHOT_NOTE_PATH,
} from "../../src/tools/vault/utils/constants.js";
import { VaultManager, VaultPathError } from "../../src/utils/VaultManger/index.js";

const TEST_VAULT_PATH = path.join(process.cwd(), "test-vault-write-boundary");
const OUTSIDE_FILE_PATH = path.join(process.cwd(), "outside-write-boundary.md");

describe("VaultManager write boundary", () => {
	beforeAll(async () => {
		await fs.mkdir(TEST_VAULT_PATH, { recursive: true });
	});

	afterEach(async () => {
		const files = await fs.readdir(TEST_VAULT_PATH);
		await Promise.all(
			files.map((file) =>
				fs.rm(path.join(TEST_VAULT_PATH, file), {
					recursive: true,
					force: true,
				}),
			),
		);
		await fs.rm(OUTSIDE_FILE_PATH, { force: true });
	});

	afterAll(async () => {
		await fs.rm(TEST_VAULT_PATH, { recursive: true, force: true });
		await fs.rm(OUTSIDE_FILE_PATH, { force: true });
	});

	test("vault 내부 경로는 writeDocument로 쓸 수 있다", async () => {
		const filePath = path.join(TEST_VAULT_PATH, "inside.md");
		await fs.writeFile(filePath, "# content");

		const vaultManager = new VaultManager(TEST_VAULT_PATH);
		await vaultManager.writeDocument("inside.md", { title: "Inside" });

		const updated = await fs.readFile(filePath, "utf-8");
		expect(updated).toContain("title: Inside");
	});

	test("vault 외부 경로는 writeDocument에서 차단된다", async () => {
		const vaultManager = new VaultManager(TEST_VAULT_PATH);

		await expect(
			vaultManager.writeDocument("../outside-write-boundary.md", {
				title: "Blocked",
			}),
		).rejects.toBeInstanceOf(VaultPathError);

		await expect(
			vaultManager.writeDocument(OUTSIDE_FILE_PATH, { title: "Blocked" }),
		).rejects.toBeInstanceOf(VaultPathError);

		await expect(fs.access(OUTSIDE_FILE_PATH)).rejects.toBeDefined();
	});

	test("vault 내부 경로는 writeRawDocument로 쓸 수 있다", async () => {
		const vaultManager = new VaultManager(TEST_VAULT_PATH);
		await vaultManager.writeRawDocument(CONTEXT_MEMORY_SNAPSHOT_NOTE_PATH, "# memory");

		const updated = await fs.readFile(
			path.join(TEST_VAULT_PATH, CONTEXT_MEMORY_SNAPSHOT_NOTE_PATH),
			"utf-8",
		);
		expect(updated).toContain("# memory");
	});

	test("vault 외부 경로는 writeRawDocument에서 차단된다", async () => {
		const vaultManager = new VaultManager(TEST_VAULT_PATH);

		await expect(
			vaultManager.writeRawDocument("../outside-write-boundary.md", "blocked"),
		).rejects.toBeInstanceOf(VaultPathError);

		await expect(
			vaultManager.writeRawDocument(OUTSIDE_FILE_PATH, "blocked"),
		).rejects.toBeInstanceOf(VaultPathError);
	});
});
