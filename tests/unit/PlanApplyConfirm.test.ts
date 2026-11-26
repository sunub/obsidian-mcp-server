import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, test } from "vitest";
import {
	DEFAULT_TIDY_OPTIONS,
	scanVault,
} from "../../src/shared/vault-ops/index.js";
import { register } from "../../src/tools/plan/index.js";
import { buildTidyPlan } from "../../src/tools/tidy/buildPlan.js";
import { cleanupFixtures, copyFixture } from "../helpers/fixture.js";

afterEach(cleanupFixtures);

type Answer =
	| { action: "accept"; content: { confirm: boolean } }
	| { action: "decline" }
	| { action: "cancel" }
	| "throw";

async function hashMap(root: string): Promise<Record<string, string>> {
	const snapshot = await scanVault(root);
	return Object.fromEntries(snapshot.files.map((f) => [f.path, f.hash]));
}

async function setup(answer: Answer | null) {
	const root = await copyFixture();
	const { plan } = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);
	const approvedOpIds = plan.ops
		.filter((op) => op.type !== "report")
		.map((op) => op.id);
	const server = new McpServer({ name: "test", version: "0" });
	register(server, { vaultRoot: () => root });
	const client = new Client(
		{ name: "test", version: "0" },
		{ capabilities: answer ? { elicitation: { form: {} } } : {} },
	);
	const messages: string[] = [];
	if (answer) {
		client.setRequestHandler(ElicitRequestSchema, (request) => {
			messages.push(request.params.message);
			if (answer === "throw") throw new Error("dialog failed");
			return answer;
		});
	}
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	await server.connect(serverSide);
	await client.connect(clientSide);
	const apply = async (ids = approvedOpIds) => {
		const response = (await client.callTool({
			name: "plan_apply",
			arguments: { planId: plan.planId, approvedOpIds: ids },
		})) as CallToolResult;
		return JSON.parse((response.content[0] as { text: string }).text);
	};
	return { root, plan, approvedOpIds, messages, apply };
}

describe("plan_apply의 사용자 확인", () => {
	test("확인하면 실행하고, 대화창에 대상 경로를 보여준다", async () => {
		const { plan, approvedOpIds, messages, apply } = await setup({
			action: "accept",
			content: { confirm: true },
		});

		const result = await apply();

		expect(result.applied).toHaveLength(approvedOpIds.length);
		expect(messages).toHaveLength(1);
		const trash = plan.ops.find((op) => op.type === "trash");
		expect(trash).toBeDefined();
		expect(messages[0]).toContain(trash?.type === "trash" ? trash.path : "");
	});

	test.each<[string, Answer]>([
		["거절", { action: "decline" }],
		["취소", { action: "cancel" }],
		["체크 해제 후 제출", { action: "accept", content: { confirm: false } }],
		["대화창 실패", "throw"],
	])("%s이면 아무것도 바꾸지 않는다", async (_label, answer) => {
		const { root, apply } = await setup(answer);
		const before = await hashMap(root);

		const result = await apply();

		expect(result.cancelled).toBe(true);
		expect(result.applied).toEqual([]);
		expect(result.runId).toBe("");
		expect(await hashMap(root)).toEqual(before);
	});

	test("elicitation을 지원하지 않는 클라이언트는 기존처럼 실행한다", async () => {
		const { approvedOpIds, apply } = await setup(null);

		const result = await apply();

		expect(result.applied).toHaveLength(approvedOpIds.length);
		expect(result.cancelled).toBeUndefined();
	});

	test("실행할 작업이 없으면 묻지 않는다", async () => {
		const { messages, apply } = await setup({ action: "decline" });

		await apply(["move:unknown"]);

		expect(messages).toEqual([]);
	});
});
