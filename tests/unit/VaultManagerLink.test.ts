import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { VaultManager } from "../../src/utils/VaultManager";

const TEST_VAULT_PATH = path.join(process.cwd(), "test-vault-links");

describe("VaultManager Link Integration Tests", () => {
	let vaultManager: VaultManager;

	beforeAll(async () => {
		await fs.mkdir(TEST_VAULT_PATH, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(TEST_VAULT_PATH, { recursive: true, force: true });
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
	});

	test("기본 위키 링크([[File]])가 백링크로 올바르게 잡혀야 한다", async () => {
		await fs.writeFile(path.join(TEST_VAULT_PATH, "Target.md"), "# Target Doc");
		await fs.writeFile(
			path.join(TEST_VAULT_PATH, "Source.md"),
			"Link to [[Target]] here.",
		);

		vaultManager = new VaultManager(TEST_VAULT_PATH);
		await vaultManager.initialize();

		const targetDocInfo = await vaultManager.getDocumentInfo("Target.md", {
			includeBacklinks: true,
		});

		expect(targetDocInfo).not.toBeNull();
		expect(targetDocInfo?.backlinks).toBeDefined();
		expect(targetDocInfo?.backlinks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					filePath: expect.stringContaining("Source.md"),
				}),
			]),
		);
	});

	test("별칭(Alias)이 포함된 링크([[File|Alias]])도 원본 파일명으로 연결되어야 한다", async () => {
		// Given: 별칭을 사용하는 링크 생성 (LinkExtractor의 '|' 처리 검증)
		await fs.writeFile(path.join(TEST_VAULT_PATH, "NoteA.md"), "I am Note A");
		await fs.writeFile(
			path.join(TEST_VAULT_PATH, "Referrer.md"),
			"Go to [[NoteA|Custom Name]] right now.",
		);

		// When
		vaultManager = new VaultManager(TEST_VAULT_PATH);
		await vaultManager.initialize();

		const noteAInfo = await vaultManager.getDocumentInfo("NoteA.md", {
			includeBacklinks: true,
		});

		// Then: Referrer가 NoteA의 백링크로 잡혀야 함
		expect(noteAInfo?.backlinks).toHaveLength(1);
		expect(noteAInfo?.backlinks?.[0].filePath).toContain("Referrer.md");
	});

	test("헤더 앵커(#)가 포함된 링크([[File#Header]])도 원본 파일명으로 연결되어야 한다", async () => {
		// Given: 앵커를 사용하는 링크 생성 (LinkExtractor의 '#' 처리 검증)
		await fs.writeFile(
			path.join(TEST_VAULT_PATH, "MainDoc.md"),
			"# Main Doc Content",
		);
		await fs.writeFile(
			path.join(TEST_VAULT_PATH, "Linker.md"),
			"See [[MainDoc#Section 1]] for details.",
		);

		// When
		vaultManager = new VaultManager(TEST_VAULT_PATH);
		await vaultManager.initialize();

		const mainDocInfo = await vaultManager.getDocumentInfo("MainDoc.md", {
			includeBacklinks: true,
		});

		// Then: Linker가 MainDoc의 백링크로 잡혀야 함
		expect(mainDocInfo?.backlinks).toHaveLength(1);
		expect(mainDocInfo?.backlinks?.[0].filePath).toContain("Linker.md");
	});

	test("다양한 링크 형식이 섞여 있어도 모두 백링크로 수집되어야 한다", async () => {
		// Given: 하나의 타겟을 가리키는 다양한 형식의 파일들
		await fs.writeFile(path.join(TEST_VAULT_PATH, "Center.md"), "Center Node");
		await fs.writeFile(path.join(TEST_VAULT_PATH, "Link1.md"), "[[Center]]");
		await fs.writeFile(
			path.join(TEST_VAULT_PATH, "Link2.md"),
			"[[Center|Alias]]",
		);
		await fs.writeFile(
			path.join(TEST_VAULT_PATH, "Link3.md"),
			"[[Center#Header]]",
		);

		// When
		vaultManager = new VaultManager(TEST_VAULT_PATH);
		await vaultManager.initialize();

		const centerInfo = await vaultManager.getDocumentInfo("Center.md", {
			includeBacklinks: true,
		});

		// Then: 3개의 파일이 모두 백링크로 잡혀야 함
		expect(centerInfo?.backlinks).toHaveLength(3);
		const backlinkPaths = centerInfo?.backlinks?.map((b) => b.filePath);
		expect(backlinkPaths).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Link1.md"),
				expect.stringContaining("Link2.md"),
				expect.stringContaining("Link3.md"),
			]),
		);
	});
});
