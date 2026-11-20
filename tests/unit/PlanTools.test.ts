import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	DEFAULT_TIDY_OPTIONS,
	scanVault,
} from "../../src/shared/vault-ops/index.js";
import { toolsWithDeps } from "../../src/tools/index.js";
import {
	executeApply,
	executeUndo,
	register,
} from "../../src/tools/plan/index.js";
import { buildTidyPlan } from "../../src/tools/tidy/buildPlan.js";
import { cleanupFixtures, copyFixture } from "../helpers/fixture.js";

afterEach(cleanupFixtures);

function textOf(result: CallToolResult): string {
	return (result.content[0] as { text: string }).text;
}

async function hashMap(root: string): Promise<Record<string, string>> {
	const snapshot = await scanVault(root);
	return Object.fromEntries(snapshot.files.map((f) => [f.path, f.hash]));
}

describe("plan_apply와 plan_undo", () => {
	test("tidy_plan 계획을 전부 승인하면 실행되고 되돌릴 수 있다", async () => {
		const root = await copyFixture();
		const before = await hashMap(root);
		const beforeEmpty = (await scanVault(root)).emptyFolders;
		const { plan } = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);
		const approvedOpIds = plan.ops
			.filter((op) => op.type !== "report")
			.map((op) => op.id);

		const applied = await executeApply(
			{ planId: plan.planId, approvedOpIds },
			{ vaultRoot: () => root },
		);

		expect(applied.isError).toBeUndefined();
		const result = JSON.parse(textOf(applied));
		expect(result.applied).toHaveLength(approvedOpIds.length);
		expect(result.rejected).toEqual([]);
		expect(await hashMap(root)).not.toEqual(before);

		const undone = await executeUndo(
			{ runId: result.runId },
			{ vaultRoot: () => root },
		);

		expect(undone.isError).toBeUndefined();
		expect(JSON.parse(textOf(undone)).conflicts).toEqual([]);
		expect(await hashMap(root)).toEqual(before);
		expect((await scanVault(root)).emptyFolders).toEqual(beforeEmpty);
	});

	test("빈 승인은 아무것도 하지 않는다", async () => {
		const root = await copyFixture();
		const { plan } = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);
		const before = await hashMap(root);

		const applied = await executeApply(
			{ planId: plan.planId, approvedOpIds: [], renames: [] },
			{ vaultRoot: () => root },
		);

		expect(JSON.parse(textOf(applied))).toEqual({
			runId: "",
			applied: [],
			rejected: [],
			rewrittenLinks: 0,
			removedFolders: [],
		});
		expect(await hashMap(root)).toEqual(before);
		const runs = await fs
			.readdir(path.join(root, ".vault-tidy", "runs"))
			.catch(() => []);
		expect(runs).toEqual([]);
	});

	test("없는 planId는 도구 오류", async () => {
		const root = await copyFixture();

		const result = await executeApply(
			{ planId: "nope", approvedOpIds: ["move:x"] },
			{ vaultRoot: () => root },
		);

		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("계획을 찾을 수 없음");
	});

	test("없는 runId는 도구 오류", async () => {
		const root = await copyFixture();

		const result = await executeUndo(
			{ runId: "nope" },
			{ vaultRoot: () => root },
		);

		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("실행 기록을 찾을 수 없음");
	});

	test("Vault 경로가 비어 있으면 도구 오류", async () => {
		const apply = await executeApply(
			{ planId: "x", approvedOpIds: ["move:x"] },
			{ vaultRoot: () => "" },
		);
		const undo = await executeUndo({ runId: "x" }, { vaultRoot: () => "" });

		expect(apply.isError).toBe(true);
		expect(undo.isError).toBe(true);
	});

	test("register는 두 도구를 등록하고 toolsWithDeps에 포함된다", () => {
		const registerTool = vi.fn();
		register({ registerTool } as unknown as McpServer, {
			vaultRoot: () => "/v",
		});

		expect(registerTool.mock.calls.map((call) => call[0])).toEqual([
			"plan_apply",
			"plan_undo",
		]);
		expect(toolsWithDeps.some((tool) => tool.register === register)).toBe(true);
	});
});
