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
import state from "@/config";
import createMcpServer from "@/server";
import { OrganizeAttachmentsResultSchema } from "@/tools/organize_attachments/params";
import { collectContextResponseDataSchema } from "@/tools/vault/types/collect_context";
import {
	type ListAllDocumentsData,
	listAllDocumentsDataSchema,
} from "@/tools/vault/types/list_all";
import { readSpecificFileDocumentData } from "@/tools/vault/types/read_specific";
import {
	DocumentSchema,
	SearchSuccessSchema,
} from "@/tools/vault/types/search";
import { FrontMatterSchema } from "@/utils/processor/types";
import demo_data from "./assets/demo_data";

const TEST_VAULT_PATH = path.join(
	process.cwd(),
	`test-vault-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
);

async function parseAndValidateResponse<T extends ZodSchema>(
	response: CompatibilityCallToolResult,
	schema: T,
): Promise<z.infer<T>> {
	if (response.isError) {
		console.error(
			"Tool execution failed content:",
			JSON.stringify(response.content, null, 2),
		);
	}
	expect(response.isError).toBe(false);
	const responseContent = response.content as { type: string; text: unknown }[];
	let text = responseContent[0].text as string;

	// Strip <system_directive> if present
	if (text.includes("<system_directive>")) {
		text = text
			.replace(/<system_directive>[\s\S]*?<\/system_directive>/, "")
			.trim();
	}

	const responseText = JSON.parse(text);
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

	// Increase timeout for E2E tests
	const E2E_TIMEOUT = 30000;

	beforeAll(async () => {
		await fs.mkdir(TEST_VAULT_PATH, { recursive: true });

		mcpClient = new Client({ name: "test-client", version: "1.0.0" });
		const stdioTransport = new StdioClientTransport({
			command: "bun",
			args: ["run", path.join(import.meta.dirname, "..", "src", "index.ts")],
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
		await fs.mkdir(TEST_VAULT_PATH, { recursive: true });

		// 배경 프로세스(LanceDB/VaultWatcher)와의 경합을 피하기 위해 재시도 로직 추가
		let retryCount = 5;
		while (retryCount > 0) {
			try {
				const files = await fs.readdir(TEST_VAULT_PATH);
				await Promise.all(
					files.map((file) =>
						fs.rm(path.join(TEST_VAULT_PATH, file), {
							recursive: true,
							force: true,
						}),
					),
				);
				break; // 성공 시 루프 탈출
			} catch (err) {
				retryCount--;
				if (retryCount === 0) throw err;
				await new Promise((resolve) => setTimeout(resolve, 200)); // 200ms 대기 후 재시도
			}
		}

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
	}, E2E_TIMEOUT);

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
		if (absoulteResponse.isError) {
			console.error(
				"Absolute read failed:",
				JSON.stringify(absoulteResponse.content, null, 2),
			);
		}

		const relativeResponse = await mcpClient.callTool({
			name: "vault",
			arguments: { action: "read", filename: RELATIVE_PATH },
		});
		if (relativeResponse.isError) {
			console.error(
				"Relative read failed:",
				JSON.stringify(relativeResponse.content, null, 2),
			);
		}

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
	}, E2E_TIMEOUT);

	test("list_all 도구는 vault의 모든 문서 목록을 반환한다", async () => {
		let response: CompatibilityCallToolResult | undefined;
		let data: ListAllDocumentsData | undefined;
		const maxRetries = 20;

		// CI 환경 대응: 파일 인덱싱이 완료될 때까지 최대 2초간 재시도
		for (let i = 0; i < maxRetries; i++) {
			response = await mcpClient.callTool({
				name: "vault",
				arguments: { action: "list_all" },
			});

			data = (await parseAndValidateResponse(
				response,
				listAllDocumentsDataSchema,
			)) as ListAllDocumentsData;

			if (data.vault_overview.total_documents === demo_data.length) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		if (!data) {
			throw new Error("Failed to get data from list_all");
		}

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
	}, E2E_TIMEOUT);

	test("vault의 collect_context 액션은 배치 메모리 패킷을 반환한다", async () => {
		let response: CompatibilityCallToolResult | undefined;
		let data: z.infer<typeof collectContextResponseDataSchema> | undefined;
		const maxRetries = 20;

		// CI 환경 대응: 파일 인덱싱이 완료되어 결과가 나올 때까지 최대 2초간 재시도
		for (let i = 0; i < maxRetries; i++) {
			response = await mcpClient.callTool({
				name: "vault",
				arguments: {
					action: "collect_context",
					scope: "all",
					maxDocs: 2,
					maxCharsPerDoc: 350,
				},
			});

			data = await parseAndValidateResponse(
				response,
				collectContextResponseDataSchema,
			);

			if (data.documents.length > 0) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		if (!data) {
			throw new Error("Failed to get data from collect_context");
		}

		expect(data.action).toBe("collect_context");
		expect(data.scope).toBe("all");
		expect(data.documents.length).toBeGreaterThan(0);
		expect(data.batch.processed_docs).toBe(data.documents.length);
		expect(data.batch.has_more).toBe(true);
		expect(typeof data.batch.continuation_token).toBe("string");
		expect(data.memory_packet.keyFacts.length).toBeGreaterThan(0);
	}, E2E_TIMEOUT);

	test('search 도구는 "Test Note" 키워드를 기반으로 문서를 찾을 수 있다', async () => {
		const searchQuery = "Getting Started with Obsidian MCP Server";
		let response: CompatibilityCallToolResult | undefined;
		const maxRetries = 20;

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

		let data: z.infer<typeof ProcessedSearchSuccessSchema> | undefined;

		// CI 환경 대응: 파일 인덱싱이 완료되어 결과가 나올 때까지 최대 2초간 재시도
		for (let i = 0; i < maxRetries; i++) {
			response = await mcpClient.callTool({
				name: "vault",
				arguments: {
					action: "search",
					keyword: searchQuery,
					includeContent: true,
				},
			});

			data = await parseAndValidateResponse(
				response,
				ProcessedSearchSuccessSchema,
			);

			if (data.found > 0) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		if (!data) {
			throw new Error("Failed to get data from search");
		}

		expect(data.query).toBe(searchQuery);
		expect(data.found).toBe(1);
		expect(data.documents.length).toBe(1);

		const doc = data.documents[0];
		expect(doc.filename).toBe(`${searchQuery}.md`);
		expect(doc.metadata.tags).toEqual(["guide", "initial"]);
		expect(
			"excerpt" in doc.content ? doc.content.excerpt : doc.content.preview,
		).toBeDefined();
	}, E2E_TIMEOUT);

	test("organize_attachments 도구는 문서의 이미지 파일을 정리할 수 있다", async () => {
		const sourceImagePath = path.join(
			import.meta.dirname,
			"assets",
			"demo_img.png",
		);
		const destinationImagePath = path.join(TEST_VAULT_PATH, "demo_img.png");
		await copyFile(sourceImagePath, destinationImagePath);

		let response: CompatibilityCallToolResult | undefined;
		let data: z.infer<typeof OrganizeAttachmentsResultSchema> | undefined;
		const maxRetries = 100; // 최대 20초 (100 * 200ms)

		// CI 환경 대응: 파일 인덱싱이 완료되어 결과가 나올 때까지 충분히 재시도
		for (let i = 0; i < maxRetries; i++) {
			response = await mcpClient.callTool({
				name: "organize_attachments",
				arguments: {
					keyword: "Test Note",
					destination: "images",
					useTitleAsFolderName: true,
				},
			});

			if (!response.isError) {
				data = await parseAndValidateResponse(
					response,
					OrganizeAttachmentsResultSchema,
				);

				if (data.details.length > 0) {
					break;
				}
			} else {
				// 에러 내용 로깅 (디버깅 용도)
				if (i % 10 === 0) {
					const errorText = response.content
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join("\n");
					console.log(`[RETRY ${i}] organize_attachments failed: ${errorText.substring(0, 100)}...`);
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}

		if (!data) {
			throw new Error("Failed to get data from organize_attachments");
		}

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
	}, E2E_TIMEOUT);
});
