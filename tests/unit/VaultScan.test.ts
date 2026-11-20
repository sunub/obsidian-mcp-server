import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { classifyFile, scanVault } from "../../src/shared/vault-ops/scan.js";
import { cleanupFixtures, copyFixture } from "../helpers/fixture.js";

const tmpRoots: string[] = [];

async function makeTmpVault(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vault-scan-"));
	tmpRoots.push(root);
	return root;
}

afterEach(async () => {
	await cleanupFixtures();
	for (const root of tmpRoots.splice(0)) {
		await fs.chmod(path.join(root, "locked.md"), 0o644).catch(() => {});
		await fs.rm(root, { recursive: true, force: true });
	}
});

describe("classifyFile", () => {
	test("확장자로 종류를 정한다", () => {
		expect(classifyFile("a/b.md")).toBe("note");
		expect(classifyFile("a/B.PNG")).toBe("attachment");
		expect(classifyFile("a/c.canvas")).toBe("other");
	});
});

describe("scanVault", () => {
	test("제외 폴더와 점으로 시작하는 파일은 스냅샷에 없다", async () => {
		const root = await copyFixture();
		const snap = await scanVault(root);
		expect(snap.files.some((f) => f.path.startsWith(".obsidian/"))).toBe(false);
		expect(snap.files.some((f) => f.path.endsWith(".gitkeep"))).toBe(false);
		expect(snap.files.some((f) => f.path === "EXPECTED.md")).toBe(false);
	});

	test("root는 인자 그대로이고 files와 folders는 오름차순이다", async () => {
		const root = await copyFixture();
		const snap = await scanVault(root);
		expect(snap.root).toBe(root);
		const sorted = (xs: string[]) => [...xs].sort();
		expect(snap.files.map((f) => f.path)).toEqual(
			sorted(snap.files.map((f) => f.path)),
		);
		expect(snap.folders).toEqual(sorted(snap.folders));
		expect(snap.emptyFolders).toEqual(sorted(snap.emptyFolders));
	});

	test("빈 폴더는 하위에 파일이 하나도 없는 폴더 전부다", async () => {
		const root = await copyFixture();
		const snap = await scanVault(root);
		expect(snap.emptyFolders).toEqual(
			["AI/무제", "AI/무제/안쪽", "빈최상위", "스터디/빈폴더"].sort(),
		);
	});

	test("바이트가 같은 파일은 해시가 같다", async () => {
		const root = await copyFixture();
		const snap = await scanVault(root);
		const h = (p: string) => snap.files.find((f) => f.path === p)?.hash;
		expect(h("스터디/HTTP.md")).toBeDefined();
		expect(h("스터디/HTTP.md")).toBe(h("스터디/1주차/HTTP.md"));
		expect(h("스터디/HTTP Methods.md")).not.toBe(
			h("스터디/1주차/HTTP Methods.md"),
		);
	});

	test("NFD 파일명은 디스크의 형태 그대로 담긴다", async () => {
		const root = await copyFixture();
		const snap = await scanVault(root);
		const session = snap.files.find(
			(f) => f.path.normalize("NFC") === "스터디/세션.md",
		);
		expect(session).toBeDefined();
		expect(path.posix.basename(session?.path ?? "")).toBe(
			"세션.md".normalize("NFD"),
		);
	});

	test("심볼릭 링크는 건너뛴다", async () => {
		const root = await makeTmpVault();
		const outside = await makeTmpVault();
		await fs.writeFile(path.join(root, "real.md"), "real");
		await fs.writeFile(path.join(outside, "secret.md"), "secret");
		await fs.symlink(
			path.join(outside, "secret.md"),
			path.join(root, "link.md"),
		);
		await fs.symlink(outside, path.join(root, "linked-dir"));

		const snap = await scanVault(root);

		expect(snap.files.map((f) => f.path)).toEqual(["real.md"]);
		expect(snap.folders).toEqual([]);
	});

	test.skipIf(process.getuid?.() === 0)(
		"읽을 수 없는 파일은 건너뛰고 나머지는 스캔한다",
		async () => {
			const root = await makeTmpVault();
			await fs.writeFile(path.join(root, "ok.md"), "ok");
			await fs.writeFile(path.join(root, "locked.md"), "locked");
			await fs.chmod(path.join(root, "locked.md"), 0o000);

			const snap = await scanVault(root);

			expect(snap.files.map((f) => f.path)).toEqual(["ok.md"]);
		},
	);

	test("크기와 종류가 채워진다", async () => {
		const root = await makeTmpVault();
		await fs.writeFile(path.join(root, "a.md"), "abc");
		await fs.writeFile(path.join(root, "b.png"), "xy");
		const snap = await scanVault(root);
		expect(snap.files).toMatchObject([
			{ path: "a.md", kind: "note", size: 3 },
			{ path: "b.png", kind: "attachment", size: 2 },
		]);
		expect(snap.files[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
	});
});
