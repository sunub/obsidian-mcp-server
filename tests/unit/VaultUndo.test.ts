import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { applyPlan, undoRun } from "../../src/shared/vault-ops/apply.js";
import { readJournal } from "../../src/shared/vault-ops/journal.js";
import { cleanupFixtures, copyFixture } from "../helpers/fixture.js";
import {
	approveAll,
	FIXTURE_OPS,
	PLAN_ID,
	savedFixturePlan,
	UNTITLED_NOTE,
	vaultState,
} from "../helpers/messyPlan.js";

afterEach(cleanupFixtures);

async function appliedFixture(renames: { path: string; title: string }[] = []) {
	const root = await copyFixture();
	await savedFixturePlan(root);
	const before = await vaultState(root);
	const result = await applyPlan(root, {
		planId: PLAN_ID,
		approvedOpIds: approveAll(FIXTURE_OPS),
		renames,
	});
	return { root, before, runId: result.runId };
}

describe("undoRun", () => {
	test("실행 후 되돌리면 모든 파일 해시와 빈 폴더가 원래와 같다", async () => {
		const { root, before, runId } = await appliedFixture();
		expect(await vaultState(root)).not.toEqual(before);

		const result = await undoRun(root, runId);

		expect(result.conflicts).toEqual([]);
		expect(result.restored).toBeGreaterThan(0);
		expect(await vaultState(root)).toEqual(before);
	});

	test("이름 변경도 함께 되돌린다", async () => {
		const { root, before, runId } = await appliedFixture([
			{ path: UNTITLED_NOTE, title: "CORS 심화" },
		]);

		await undoRun(root, runId);

		expect(await vaultState(root)).toEqual(before);
	});

	test("되돌린 실행에는 undoneAt이 기록된다", async () => {
		const { root, runId } = await appliedFixture();

		await undoRun(root, runId);

		expect((await readJournal(root, runId))?.undoneAt).not.toBeNull();
	});

	test("되돌리기 전에 고친 노트는 충돌로 보고하고 덮어쓰지 않는다", async () => {
		const { root, runId } = await appliedFixture();
		const cors = path.join(root, "스터디/5주차/CORS.md");
		await fs.appendFile(cors, "\n사용자가 고친 줄", "utf-8");
		const edited = await fs.readFile(cors, "utf-8");

		const result = await undoRun(root, runId);

		expect(result.conflicts).toEqual([
			{ path: "스터디/5주차/CORS.md", reason: "실행 후 바뀜" },
		]);
		expect(await fs.readFile(cors, "utf-8")).toBe(edited);
	});

	test("옮겨진 파일을 고쳤다면 그 파일은 제자리로 돌리지 않는다", async () => {
		const { root, runId } = await appliedFixture();
		const moved = path.join(root, "attachments/database.png");
		await fs.appendFile(moved, "edited");

		const result = await undoRun(root, runId);

		expect(result.conflicts).toEqual([
			{ path: "attachments/database.png", reason: "실행 후 바뀜" },
			{ path: "attachments", reason: "실행 후 바뀜" },
		]);
		await expect(fs.access(moved)).resolves.toBeUndefined();
		await expect(fs.access(path.join(root, "database.png"))).rejects.toThrow();
	});

	test("원래 자리가 이미 채워졌다면 충돌로 보고한다", async () => {
		const { root, runId } = await appliedFixture();
		await fs.writeFile(path.join(root, "database.png"), "새 파일");

		const result = await undoRun(root, runId);

		expect(result.conflicts).toEqual([
			{ path: "attachments/database.png", reason: "실행 후 바뀜" },
			{ path: "attachments", reason: "실행 후 바뀜" },
		]);
		expect(await fs.readFile(path.join(root, "database.png"), "utf-8")).toBe(
			"새 파일",
		);
	});

	test("두 번 되돌리면 오류", async () => {
		const { root, runId } = await appliedFixture();
		await undoRun(root, runId);

		await expect(undoRun(root, runId)).rejects.toThrow(
			`이미 되돌린 실행: ${runId}`,
		);
	});

	test("기록이 없으면 오류", async () => {
		const root = await copyFixture();

		await expect(undoRun(root, "nope")).rejects.toThrow(
			"실행 기록을 찾을 수 없음: nope",
		);
	});
});
