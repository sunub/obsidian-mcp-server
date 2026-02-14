import fs, { copyFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CompatibilityCallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";
import { type ZodSchema, z } from "zod";
import state from "../src/config";
import createMcpServer from "../src/server";
import { OrganizeAttachmentsResultSchema } from "../src/tools/organize_attachments/params";
import { collectContextResponseDataSchema } from "../src/tools/vault/types/collect_context";
import {
	type ListAllDocumentsData,
	listAllDocumentsDataSchema,
} from "../src/tools/vault/types/list_all";
import { readSpecificFileDocumentData } from "../src/tools/vault/types/read_specific";
import {
	DocumentSchema,
	SearchSuccessSchema,
} from "../src/tools/vault/types/search";
import { FrontMatterSchema } from "../src/utils/processor/types";
import demo_data from "./assets/demo_data";

const TEST_VAULT_PATH = path.join(process.cwd(), "test-vault");

async function parseAndValidateResponse<T extends ZodSchema>(
	response: CompatibilityCallToolResult,
	schema: T,
): Promise<z.infer<T>> {
	expect(response.isError).toBe(false);
	const responseContent = response.content as { type: string; text: unknown }[];
	const responseText = JSON.parse(responseContent[0].text as string);
	const parsed = schema.safeParse(responseText);

	if (!parsed.success) {
		console.error("Schema validation failed:", parsed.error.format());
		throw new Error("Response schema validation failed");
	}

	return parsed.data;
}

describe("Obsidian MCP Server E2E Tests", () => {
	let mcpClient: Client;
	let _transport: StdioClientTransport | InMemoryTransport;
	let embeddedServer: ReturnType<typeof createMcpServer> | null = null;
	let transportMode: "stdio" | "in_memory" = "stdio";

	beforeAll(async () => {
		await fs.mkdir(TEST_VAULT_PATH, { recursive: true });

		mcpClient = new Client({ name: "test-client", version: "1.0.0" });
		const stdioTransport = new StdioClientTransport({
			command: "node",
			args: ["build/index.js"],
			env: {
				...process.env,
				VAULT_DIR_PATH: TEST_VAULT_PATH,
				NODE_ENV: "test",
			},
		});

		try {
			await mcpClient.connect(stdioTransport);
			_transport = stdioTransport;
			transportMode = "stdio";
		} catch {
			const [clientTransport, serverTransport] =
				InMemoryTransport.createLinkedPair();
			state.vaultPath = TEST_VAULT_PATH;
			embeddedServer = createMcpServer();
			await embeddedServer.connect(serverTransport);
			await mcpClient.connect(clientTransport);
			_transport = clientTransport;
			transportMode = "in_memory";
		}
	});

	afterAll(async () => {
		if (mcpClient) {
			await mcpClient.close();
		}
		if (embeddedServer) {
			await embeddedServer.close();
		}
		await fs.rm(TEST_VAULT_PATH, { recursive: true, force: true });
	});

	beforeEach(async () => {
		const files = await fs.readdir(TEST_VAULT_PATH);
		await Promise.all(
			files.map((file) =>
				fs.rm(path.join(TEST_VAULT_PATH, file), {
					recursive: true,
					force: true,
				}),
			),
		);

		for (const { title, tags, content } of demo_data) {
			const { text } = content;
			const tagsYaml = tags.map((tag) => `  - ${tag}`).join("\n");
			const frontmatter = `---\ntitle: ${title}\ntags:\n${tagsYaml}\n---\n\n`;
			const fileName = `${title.replace(/[/\\?%*:|"<>]/g, "-")}.md`;
			const filePath = path.join(TEST_VAULT_PATH, fileName);
			await fs.writeFile(filePath, frontmatter + text);
		}
	});

	afterEach(async () => {});

	test("서버에 등록된 모든 도구 목록을 가져올 수 있다", async () => {
		const toolsResult = await mcpClient.listTools();
		const toolNames = toolsResult.tools.map((tool) => tool.name);

		const expectedTools = [
			"vault",
			"create_document_with_properties",
			"write_property",
			"generate_property",
			"organize_attachments",
		];

		expect(toolNames).toEqual(expect.arrayContaining(expectedTools));
		expect(toolNames.length).toBe(expectedTools.length);
		expect(["stdio", "in_memory"]).toContain(transportMode);
	});

	test("vault의 read 액션은 적절하게 문서를 읽어올 수 있는가?", async () => {
		const ABSOLUTE_PATH = path.join(
			TEST_VAULT_PATH,
			"Getting Started with Obsidian MCP Server.md",
		);
		const RELATIVE_PATH = "Getting Started with Obsidian MCP Server.md";

		const absoulteResponse = await mcpClient.callTool({
			name: "vault",
			arguments: { action: "read", filename: ABSOLUTE_PATH },
		});

		const relativeResponse = await mcpClient.callTool({
			name: "vault",
			arguments: { action: "read", filename: RELATIVE_PATH },
		});

		expect(absoulteResponse.isError).toBe(false);
		expect(relativeResponse.isError).toBe(false);

		const absoulteData = await parseAndValidateResponse(
			absoulteResponse,
			readSpecificFileDocumentData,
		);
		const relativeData = await parseAndValidateResponse(
			relativeResponse,
			readSpecificFileDocumentData,
		);

		expect(absoulteData.contentLength).toBeGreaterThan(0);
		expect(relativeData.contentLength).toBeGreaterThan(0);

		expect(absoulteData.contentLength).toBe(relativeData.contentLength);
		expect(absoulteData.filename).toBe(relativeData.filename);
		expect(absoulteData.metadata).toEqual(relativeData.metadata);
		expect(absoulteData.content).toEqual(relativeData.content);
	});

	test("list_all 도구는 vault의 모든 문서 목록을 반환한다", async () => {
		const response = await mcpClient.callTool({
			name: "vault",
			arguments: { action: "list_all" },
		});

		const data = (await parseAndValidateResponse(
			response,
			listAllDocumentsDataSchema,
		)) as ListAllDocumentsData;

		expect(data.vault_overview.total_documents).toBe(demo_data.length);
		expect(data.documents.length).toBe(demo_data.length);

		const sortedDocuments = [...data.documents].sort((a, b) =>
			(a.metadata.title || "").localeCompare(b.metadata.title || ""),
		);
		const sortedDemoData = [...demo_data].sort((a, b) =>
			a.title.localeCompare(b.title),
		);

		for (let i = 0; i < sortedDemoData.length; i++) {
			const demo = sortedDemoData[i];
			expect(sortedDocuments[i].metadata.title).toBe(demo.title);
			expect(sortedDocuments[i].metadata.tags).toEqual(demo.tags);
		}
	});

	test("vault의 collect_context 액션은 배치 메모리 패킷을 반환한다", async () => {
		const response = await mcpClient.callTool({
			name: "vault",
			arguments: {
				action: "collect_context",
				scope: "all",
				maxDocs: 2,
				maxCharsPerDoc: 350,
			},
		});

		const data = await parseAndValidateResponse(
			response,
			collectContextResponseDataSchema,
		);

		expect(data.action).toBe("collect_context");
		expect(data.scope).toBe("all");
		expect(data.documents.length).toBeGreaterThan(0);
		expect(data.batch.processed_docs).toBe(data.documents.length);
		expect(data.batch.has_more).toBe(true);
		expect(typeof data.batch.continuation_token).toBe("string");
		expect(data.memory_packet.keyFacts.length).toBeGreaterThan(0);
	});

	test('search 도구는 "Test Note" 키워드를 기반으로 문서를 찾을 수 있다', async () => {
		const searchQuery = "Getting Started with Obsidian MCP Server";
		const response = await mcpClient.callTool({
			name: "vault",
			arguments: {
				action: "search",
				keyword: searchQuery,
				includeContent: true,
			},
		});

		const ProcessedFrontMatterSchema = FrontMatterSchema.extend({
			title: z.string(),
			tags: z.array(z.string()),
		});

		const ProcessedDocumentSchema = DocumentSchema.extend({
			metadata: ProcessedFrontMatterSchema,
		});

		const ProcessedSearchSuccessSchema = SearchSuccessSchema.extend({
			documents: z.array(ProcessedDocumentSchema),
		});

		const data = await parseAndValidateResponse(
			response,
			ProcessedSearchSuccessSchema,
		);

		expect(data.query).toBe(searchQuery);
		expect(data.found).toBe(1);
		expect(data.documents.length).toBe(1);

		const doc = data.documents[0];
		expect(doc.filename).toBe(`${searchQuery}.md`);
		expect(doc.metadata.tags).toEqual(["guide", "initial"]);
		expect(
			"excerpt" in doc.content ? doc.content.excerpt : doc.content.preview,
		).toBeDefined();
	});

	test("organize_attachments 도구는 문서의 이미지 파일을 정리할 수 있다", async () => {
		const sourceImagePath = path.join(
			process.cwd(),
			"tests",
			"assets",
			"demo_img.png",
		);
		const destinationImagePath = path.join(TEST_VAULT_PATH, "demo_img.png");
		await copyFile(sourceImagePath, destinationImagePath);

		const response = await mcpClient.callTool({
			name: "organize_attachments",
			arguments: {
				keyword: "Test Note",
				destination: "images",
				useTitleAsFolderName: true,
			},
		});
		const data = await parseAndValidateResponse(
			response,
			OrganizeAttachmentsResultSchema,
		);

		const detail = data.details.find((d) =>
			d.document.includes("Test Note.md"),
		);
		expect(detail?.status).toBe("success");
		expect(detail?.movedFiles).toBe(1);
		expect(detail?.targetDirectory).toBe("images/Test Note");

		const movedImagePath = path.join(
			TEST_VAULT_PATH,
			"images",
			"Test Note",
			"demo_img.png",
		);
		const movedImageStat = await fs.stat(movedImagePath);
		expect(movedImageStat.isFile()).toBe(true);
	});
});
