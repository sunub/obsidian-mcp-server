import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import createMcpServer from "../../src/server.js";
import { ServerLifecycle } from "../../src/shared/lifecycle/ServerLifecycle.js";

describe("MCP 서버 instructions", () => {
	let client: Client;
	let instructions: string;
	let toolNames: string[];

	beforeAll(async () => {
		const server = createMcpServer(new ServerLifecycle());
		client = new Client({ name: "test-client", version: "0.0.0" });
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
		instructions = client.getInstructions() ?? "";
		toolNames = (await client.listTools()).tools.map((tool) => tool.name);
	});

	afterAll(async () => {
		await client.close();
	});

	test("다루는 범위를 VAULT_DIR_PATH로 알린다", () => {
		expect(instructions).toContain("Obsidian vault");
		expect(instructions).toContain("VAULT_DIR_PATH");
	});

	test("도구별 사용법은 도구 설명과 Skill에 두고 반복하지 않는다", () => {
		expect(
			toolNames.filter((name) => instructions.includes(`- ${name}:`)),
		).toEqual([]);
		expect(instructions).not.toContain("action=");
		expect(instructions).not.toContain("setup");
	});
});
