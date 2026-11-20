import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { cleanupFixtures, copyFixture } from "../helpers/fixture.js";

describe("copyFixture", () => {
	afterEach(async () => {
		await cleanupFixtures();
	});

	test("복사본에 Docker.md가 있고 EXPECTED.md는 없다", async () => {
		const root = await copyFixture();
		await expect(
			fs.access(path.join(root, "Docker.md")),
		).resolves.toBeUndefined();
		await expect(fs.access(path.join(root, "EXPECTED.md"))).rejects.toThrow();
	});

	test("두 번 호출하면 경로가 다르다", async () => {
		const first = await copyFixture();
		const second = await copyFixture();
		expect(first).not.toBe(second);
	});

	test(".gitkeep을 포함해 복사한다", async () => {
		const root = await copyFixture();
		await expect(
			fs.access(path.join(root, "빈최상위", ".gitkeep")),
		).resolves.toBeUndefined();
	});

	test("스터디/세션.md는 NFD 파일명으로 존재한다", async () => {
		const root = await copyFixture();
		const names = await fs.readdir(path.join(root, "스터디"));
		const session = names.find((name) => name.normalize("NFC") === "세션.md");
		expect(session).toBe("세션.md".normalize("NFD"));
	});

	test("cleanupFixtures는 만든 폴더를 모두 지운다", async () => {
		const root = await copyFixture();
		await cleanupFixtures();
		await expect(fs.access(root)).rejects.toThrow();
	});
});
