import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { register } from "../../src/tools/vault/index.js";

type VaultSchema = {
	properties: Record<string, { enum?: string[] }>;
};

describe("vault 도구 입력 스키마", () => {
	let client: Client;
	let schema: VaultSchema;

	beforeAll(async () => {
		const server = new McpServer({ name: "test", version: "0.0.0" });
		register(server);
		client = new Client({ name: "test-client", version: "0.0.0" });
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
		const [tool] = (await client.listTools()).tools;
		schema = tool?.inputSchema as unknown as VaultSchema;
	});

	afterAll(async () => {
		await client.close();
	});

	test("검색, 읽기, 목록, 상태 액션만 제공한다", () => {
		expect(schema.properties["action"]?.enum).toEqual([
			"search",
			"read",
			"list_all",
			"stats",
		]);
	});

	test("collect_context 전용 파라미터를 받지 않는다", () => {
		const removed = [
			"topic",
			"scope",
			"maxDocs",
			"maxCharsPerDoc",
			"continuationToken",
		].filter((name) => name in schema.properties);

		expect(removed).toEqual([]);
	});
});
