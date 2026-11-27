import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { loadPlan } from "../../src/shared/vault-ops/index.js";
import { toolsWithDeps } from "../../src/tools/index.js";
import { execute, name, register } from "../../src/tools/tidy/index.js";
import { cleanupFixtures, copyFixture } from "../helpers/fixture.js";

afterEach(cleanupFixtures);

function textOf(result: CallToolResult): string {
	return (result.content[0] as { text: string }).text;
}

describe("tidy_plan execute", () => {
	test("미리보기 JSON을 돌려주고 계획을 저장한다", async () => {
		const root = await copyFixture();

		const result = await execute({}, { vaultRoot: () => root });

		expect(result.isError).toBeUndefined();
		const preview = JSON.parse(textOf(result));
		expect(preview.planId).toMatch(/^\d{8}-\d{6}-/);
		expect(preview.summary.bulk).toBeGreaterThan(0);
		expect(await loadPlan(root, preview.planId)).not.toBeNull();
	});

	test("scope를 주면 그 폴더만 계획한다", async () => {
		const root = await copyFixture();

		const result = await execute({ scope: "sunub" }, { vaultRoot: () => root });

		const preview = JSON.parse(textOf(result));
		const plan = await loadPlan(root, preview.planId);
		expect(plan?.scope).toBe("sunub");
		expect(preview.summary.needsTitle).toBe(0);
	});

	test("planners로 실행할 플래너를 고른다", async () => {
		const root = await copyFixture();

		const result = await execute(
			{ planners: ["untitled"] },
			{ vaultRoot: () => root },
		);

		const preview = JSON.parse(textOf(result));
		expect(preview.summary.needsTitle).toBe(1);
		expect(preview.bulk).toEqual([]);
	});

	test("attachmentsFolderName으로 첨부 폴더 이름을 바꾼다", async () => {
		const root = await copyFixture();

		const result = await execute(
			{ planners: ["attachments"], attachmentsFolderName: "assets" },
			{ vaultRoot: () => root },
		);

		const preview = JSON.parse(textOf(result));
		expect(preview.bulk).toContainEqual(
			expect.objectContaining({
				path: "database.png",
				to: "assets/database.png",
			}),
		);
	});

	test("없는 scope는 도구 오류", async () => {
		const root = await copyFixture();

		const result = await execute(
			{ scope: "없는폴더" },
			{ vaultRoot: () => root },
		);

		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("없는폴더");
	});

	test("경로 탈출 scope는 도구 오류", async () => {
		const root = await copyFixture();

		for (const scope of ["../x", "스터디/5주차", "a\\b"]) {
			const result = await execute({ scope }, { vaultRoot: () => root });
			expect(result.isError, scope).toBe(true);
		}
	});

	test("경로 문자가 든 attachmentsFolderName은 도구 오류", async () => {
		const root = await copyFixture();

		for (const attachmentsFolderName of ["../x", "a/b", ""]) {
			const result = await execute(
				{ attachmentsFolderName },
				{ vaultRoot: () => root },
			);
			expect(result.isError, attachmentsFolderName).toBe(true);
		}
	});

	test("Vault 경로가 비어 있으면 도구 오류", async () => {
		const result = await execute({}, { vaultRoot: () => "" });

		expect(result.isError).toBe(true);
	});

	test("Vault 경로가 폴더가 아니면 도구 오류", async () => {
		const missing = path.join(os.tmpdir(), "tidy-plan-does-not-exist");
		await fs.rm(missing, { recursive: true, force: true });

		const result = await execute({}, { vaultRoot: () => missing });

		expect(result.isError).toBe(true);
	});
});

describe("tidy_plan register", () => {
	function registered() {
		const registerTool = vi.fn();
		const deps = { vaultRoot: () => "/vault" };
		register({ registerTool } as unknown as McpServer, deps);
		const [toolName, config, handler] = registerTool.mock.calls[0] as [
			string,
			{
				title: string;
				description: string;
				inputSchema: Record<string, unknown>;
				annotations: Record<string, unknown>;
			},
			(params: unknown) => Promise<CallToolResult>,
		];
		return { registerTool, toolName, config, handler };
	}

	test("tidy_plan 이름으로 한 번 등록한다", () => {
		const { registerTool, toolName } = registered();

		expect(name).toBe("tidy_plan");
		expect(toolName).toBe("tidy_plan");
		expect(registerTool).toHaveBeenCalledTimes(1);
	});

	test("입력 스키마는 scope, planners, attachmentsFolderName이다", () => {
		const { config } = registered();

		expect(Object.keys(config.inputSchema).sort()).toEqual([
			"attachmentsFolderName",
			"planners",
			"scope",
		]);
	});

	test("파일을 바꾸지 않는 계획 도구임을 annotations로 밝힌다", () => {
		const { config } = registered();

		expect(config.annotations).toMatchObject({
			readOnlyHint: false,
			destructiveHint: false,
		});
	});

	test("설명문은 파일 미변경과 입출력 계약만 담고 Skill 절차를 중복하지 않는다", () => {
		const { config } = registered();

		expect(config.description).toMatch(/does not (change|modify)/i);
		expect(config.description).toContain("planId");
		expect(config.description).toContain("needsTitle");
		expect(config.description).not.toContain("How to use the result");
	});

	test("핸들러는 등록 때 받은 deps로 실행한다", async () => {
		const { handler } = registered();

		const result = await handler({});

		expect(result.isError).toBe(true);
	});

	test("도구 목록 toolsWithDeps에 포함되어 있다", () => {
		const registerTool = vi.fn();

		for (const tool of toolsWithDeps) {
			tool.register({ registerTool } as unknown as McpServer, {
				vaultRoot: () => "/vault",
			});
		}

		expect(registerTool.mock.calls.map((call) => call[0])).toContain(
			"tidy_plan",
		);
	});
});
