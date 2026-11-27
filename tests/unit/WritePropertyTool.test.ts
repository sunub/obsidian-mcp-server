import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import matter from "gray-matter";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import state from "../../src/config.js";
import { localEmbedder } from "../../src/shared/local-ai/Embedder.js";
import { register } from "../../src/tools/write_property/index.js";

describe("write_property 도구", () => {
	const originalVaultPath = state.vaultPath;
	let vault: string;
	let client: Client;
	let server: McpServer;

	beforeAll(async () => {
		vault = await mkdtemp(join(tmpdir(), "write-property-"));
		state.vaultPath = vault;
		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(false);

		server = new McpServer({ name: "test", version: "0.0.0" });
		register(server);
		client = new Client({ name: "test-client", version: "0.0.0" });
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
	});

	afterAll(async () => {
		await client.close();
		await server.close();
		state.vaultPath = originalVaultPath;
		vi.restoreAllMocks();
		await rm(vault, { recursive: true, force: true });
	});

	const write = async (
		name: string,
		initial: string,
		properties: Record<string, unknown>,
	) => {
		const file = join(vault, name);
		await writeFile(file, initial, "utf-8");
		const response = await client.callTool({
			name: "write_property",
			arguments: { filePath: name, properties },
		});
		expect(response.isError).toBeFalsy();
		return matter(await readFile(file, "utf-8"), {});
	};

	test("정해진 목록에 없는 속성도 파일에 쓴다", async () => {
		const written = await write("custom.md", "본문\n", {
			title: "제목",
			author: "someone",
			rating: 4,
			aliases: ["a", "b"],
			source: { url: "https://example.com", visited: true },
			reviewed: null,
		});

		expect(written.data).toEqual({
			title: "제목",
			author: "someone",
			rating: 4,
			aliases: ["a", "b"],
			source: { url: "https://example.com", visited: true },
			reviewed: null,
		});
		expect(written.content.trim()).toBe("본문");
	});

	test("넘기지 않은 기존 속성은 유지하고 같은 이름은 덮어쓴다", async () => {
		const written = await write(
			"merge.md",
			"---\nauthor: before\nstatus: draft\n---\n본문\n",
			{ author: "after" },
		);

		expect(written.data).toEqual({ author: "after", status: "draft" });
	});

	test("알려진 속성의 타입이 틀리면 쓰지 않는다", async () => {
		const file = join(vault, "invalid.md");
		await writeFile(file, "본문\n", "utf-8");

		const response = await client
			.callTool({
				name: "write_property",
				arguments: { filePath: "invalid.md", properties: { tags: "one" } },
			})
			.catch((error: Error) => ({ isError: true, error }));

		expect(response.isError).toBe(true);
		expect(await readFile(file, "utf-8")).toBe("본문\n");
	});
});
