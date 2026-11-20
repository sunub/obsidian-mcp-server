import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	readJournal,
	writeJournal,
} from "../../src/shared/vault-ops/journal.js";
import { loadPlan, savePlan } from "../../src/shared/vault-ops/planStore.js";
import type {
	ChangePlan,
	RunJournal,
} from "../../src/shared/vault-ops/types.js";

const plan: ChangePlan = {
	planId: "20261120-000000-abc123",
	createdAt: "2026-11-20T00:00:00.000Z",
	source: "test",
	scope: null,
	ops: [
		{
			id: "move:a.png",
			type: "move",
			from: "a.png",
			to: "attachments/a.png",
			tier: "bulk",
			reason: "r",
		},
	],
	needsTitle: [],
	fileHashes: { "a.png": "h" },
};

const journal = (entries: RunJournal["entries"]): RunJournal => ({
	runId: "20261120-000000-run001",
	planId: plan.planId,
	createdAt: "2026-11-20T00:00:00.000Z",
	undoneAt: null,
	entries,
});

describe("vault-ops 저장소", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "vault-ops-store-"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	test("저장한 계획을 그대로 읽는다", async () => {
		await savePlan(root, plan);
		expect(await loadPlan(root, plan.planId)).toEqual(plan);
	});

	test("없는 계획은 null", async () => {
		expect(await loadPlan(root, "nope")).toBeNull();
	});

	test("손상된 JSON은 null", async () => {
		const dir = path.join(root, ".vault-tidy", "plans");
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, "broken.json"), "{");
		expect(await loadPlan(root, "broken")).toBeNull();
	});

	test("경로 탈출 id는 읽기는 null, 쓰기는 예외", async () => {
		expect(await loadPlan(root, "../x")).toBeNull();
		expect(await loadPlan(root, "a/b")).toBeNull();
		expect(await loadPlan(root, "a\\b")).toBeNull();
		expect(await readJournal(root, "../x")).toBeNull();
		await expect(savePlan(root, { ...plan, planId: "../x" })).rejects.toThrow();
		await expect(
			writeJournal(root, { ...journal([]), runId: "a/b" }),
		).rejects.toThrow();
	});

	test("없는 실행 기록과 손상된 실행 기록은 null", async () => {
		expect(await readJournal(root, "nope")).toBeNull();
		const dir = path.join(root, ".vault-tidy", "runs");
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, "broken.json"), "");
		expect(await readJournal(root, "broken")).toBeNull();
	});

	test("실행 기록을 덮어써도 마지막 내용이 남는다", async () => {
		await writeJournal(root, journal([]));
		const second = journal([{ kind: "createFolder", path: "attachments" }]);
		await writeJournal(root, second);
		expect(await readJournal(root, second.runId)).toEqual(second);
		const files = await fs.readdir(path.join(root, ".vault-tidy", "runs"));
		expect(files).toEqual([`${second.runId}.json`]);
	});
});
