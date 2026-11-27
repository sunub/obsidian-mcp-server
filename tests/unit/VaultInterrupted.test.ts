import fs from "node:fs/promises";
import { afterEach, describe, expect, test, vi } from "vitest";
import { applyPlan, undoRun } from "../../src/shared/vault-ops/apply.js";
import { cleanupFixtures, copyFixture } from "../helpers/fixture.js";
import {
	approveAll,
	FIXTURE_OPS,
	PLAN_ID,
	savedFixturePlan,
	vaultState,
} from "../helpers/messyPlan.js";

afterEach(async () => {
	vi.restoreAllMocks();
	await cleanupFixtures();
});

const MUTATIONS = ["writeFile", "rename", "mkdir", "rmdir", "unlink"] as const;

function stopAfter(limit: number): void {
	let calls = 0;
	for (const name of MUTATIONS) {
		const real = (fs[name] as (...args: unknown[]) => Promise<unknown>).bind(
			fs,
		);
		vi.spyOn(fs, name).mockImplementation((async (...args: unknown[]) => {
			calls += 1;
			if (calls > limit) throw new Error("중단");
			return real(...args);
		}) as never);
	}
}

async function interruptedRun(limit: number) {
	const root = await copyFixture();
	await savedFixturePlan(root);
	const before = await vaultState(root);

	stopAfter(limit);
	const failure = await applyPlan(root, {
		planId: PLAN_ID,
		approvedOpIds: approveAll(FIXTURE_OPS),
		renames: [],
	}).then(
		() => null,
		(error: Error) => error.message,
	);
	vi.restoreAllMocks();

	return { root, before, failure };
}

describe("중단된 실행의 되돌리기", () => {
	test("어느 파일 작업 직후에 멈춰도 원래 상태로 돌아간다", async () => {
		const broken: string[] = [];
		let undone = 0;

		for (let limit = 0; ; limit += 1) {
			const { root, before, failure } = await interruptedRun(limit);
			if (failure === null) break;
			const runId = failure.match(/runId: ([\w-]+)/)?.[1];
			if (runId) {
				const result = await undoRun(root, runId);
				undone += 1;
				if (result.conflicts.length > 0) {
					broken.push(`${limit}: 충돌 ${result.conflicts[0]?.path}`);
					continue;
				}
			}
			const after = await vaultState(root);
			if (JSON.stringify(after) !== JSON.stringify(before)) {
				broken.push(`${limit}: 상태 불일치`);
			}
		}

		expect(undone).toBeGreaterThan(FIXTURE_OPS.length);
		expect(broken).toEqual([]);
	}, 60000);
});
