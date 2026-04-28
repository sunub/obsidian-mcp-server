import fs, { copyFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CompatibilityCallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type ZodSchema, z } from "zod";
import state from "../src/config";
import createMcpServer from "../src/server";
import { OrganizeAttachmentsResultSchema } from "../src/tools/organize_attachments/params";
import { collectContextResponseDataSchema } from "../src/tools/vault/types/collect_context";
import {
	type ListAllDocumentsData,
	listAllDocumentsDataSchema,
} from "../src/tools/vault/types/list_all.ts";
import { readSpecificFileDocumentData } from "../src/tools/vault/types/read_specific";
import {
	DocumentSchema,
	SearchSuccessSchema,
} from "../src/tools/vault/types/search";
import { FrontMatterSchema } from "../src/utils/processor/types";
import demo_data from "./assets/demo_data";

const TEST_VAULT_PATH = path.join(process.cwd(), "test-vault");

/**
 * 파일 잠금 및 ENOTEMPTY 에러를 방지하기 위한 방어적 삭제 유틸리티
 */
async function safeRm(targetPath: string) {
	for (let i = 0; i < 5; i++) {
		try {
			await fs.rm(targetPath, { recursive: true, force: true });
			return;
		} catch (err: unknown) {
			if (i === 4) throw err;
			// 잠시 대기 후 재시도 (LanceDB 잠금 해제 시간 고려)
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
}

async function parseAndValidateResponse<T extends ZodSchema>(
	response: CompatibilityCallToolResult,
	schema: T,
): Promise<z.infer<T>> {
	expect(response.isError).toBe(false);
	const responseContent = response.content as { type: string; text: string }[];
	let text = responseContent[0].text;

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

/**
 * 벡터 인덱싱이 완료될 때까지 대기하는 헬퍼
 */
async function waitForIndexing(mcpClient: Client, expectedCount: number) {
	const maxRetries = 20;
	for (let i = 0; i < maxRetries; i++) {
		const response = await mcpClient.callTool({
			name: "vault",
			arguments: { action: "list_all" },
		});

		const data = (await parseAndValidateResponse(
			response,
			listAllDocumentsDataSchema,
		)) as ListAllDocumentsData;

		if (data.vault_overview.total_documents === expectedCount) {
			return data;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(
		`Indexing timeout: Expected ${expectedCount} docs, but server reports different count.`,
	);
}

describe("Obsidian MCP Server E2E Tests", () => {
	let mcpClient: Client;
	let embeddedServer: ReturnType<typeof createMcpServer> | null = null;

	beforeAll(async () => {
		// 1. 깨끗한 테스트 환경 조성
		await safeRm(TEST_VAULT_PATH);
		await fs.mkdir(TEST_VAULT_PATH, { recursive: true });

		// 2. 테스트 데이터 생성
		for (const { title, tags, content } of demo_data) {
			const tagsYaml = tags.map((tag) => `  - ${tag}`).join("\n");
			const frontmatter = `---\ntitle: ${title}\ntags:\n${tagsYaml}\n---\n\n`;
			const fileName = `${title.replace(/[/\\?%*:|"<>]/g, "-")}.md`;
			await fs.writeFile(
				path.join(TEST_VAULT_PATH, fileName),
				frontmatter + content.text,
			);
		}

		// 3. 서버 시작 (In-Memory 방식이 테스트 격리에 더 유리함)
		mcpClient = new Client({ name: "test-client", version: "1.0.0" });
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();

		state.vaultPath = TEST_VAULT_PATH;
		embeddedServer = createMcpServer();
		await embeddedServer.connect(serverTransport);
		await mcpClient.connect(clientTransport);

		// 4. 모든 테스트 시작 전 인덱싱 완료 보장
		await waitForIndexing(mcpClient, demo_data.length);
	});

	afterAll(async () => {
		if (mcpClient) await mcpClient.close();
		if (embeddedServer) await embeddedServer.close();
		await safeRm(TEST_VAULT_PATH);
	});

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
	});

	describe("Read-only Actions", () => {
		test("vault: read - 문서를 정확히 읽어온다", async () => {
			const filename = "Getting Started with Obsidian MCP Server.md";
			const response = await mcpClient.callTool({
				name: "vault",
				arguments: { action: "read", filename },
			});

			const data = await parseAndValidateResponse(
				response,
				readSpecificFileDocumentData,
			);
			const frontmatter = FrontMatterSchema.parse(data.frontmatter);

			expect(frontmatter.title).toBe(filename.replace(".md", ""));
			expect(data.contentLength).toBeGreaterThan(0);
		});

		test("vault: list_all - 모든 문서 목록을 반환한다", async () => {
			const response = await mcpClient.callTool({
				name: "vault",
				arguments: { action: "list_all" },
			});

			const data = await parseAndValidateResponse(
				response,
				listAllDocumentsDataSchema,
			);

			expect(data.vault_overview.total_documents).toBe(demo_data.length);
			expect(data.documents.length).toBe(demo_data.length);
		});

		test("vault: collect_context - 시맨틱 컨텍스트를 추출한다", async () => {
			const response = await mcpClient.callTool({
				name: "vault",
				arguments: { action: "collect_context", scope: "all", maxDocs: 2 },
			});

			const data = await parseAndValidateResponse(
				response,
				collectContextResponseDataSchema,
			);

			expect(data.documents.length).toBeGreaterThan(0);
			expect(data.memory_packet.keyFacts.length).toBeGreaterThan(0);
		});

		test("vault: search - 키워드 기반 검색이 작동한다", async () => {
			const query = "Getting Started with Obsidian MCP Server";
			const response = await mcpClient.callTool({
				name: "vault",
				arguments: { action: "search", keyword: query },
			});

			// 검색 결과 스키마 검증
			const SearchResultSchema = SearchSuccessSchema.extend({
				documents: z.array(
					DocumentSchema.extend({
						metadata: FrontMatterSchema.extend({
							title: z.string(),
							tags: z.array(z.string()),
						}),
					}),
				),
			});

			const data = await parseAndValidateResponse(response, SearchResultSchema);

			expect(data.found).toBeGreaterThan(0);
			expect(data.documents[0].filename).toBe(`${query}.md`);
		});
	});

	describe("Mutation Actions", () => {
		test("organize_attachments - 이미지 파일을 정리한다", async () => {
			// 테스트용 이미지 준비
			const sourceImg = path.join(
				process.cwd(),
				"tests",
				"assets",
				"demo_img.png",
			);
			const targetImg = path.join(TEST_VAULT_PATH, "demo_img.png");
			await copyFile(sourceImg, targetImg);

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

			// 물리적 파일 이동 확인
			const movedPath = path.join(
				TEST_VAULT_PATH,
				"images",
				"Test Note",
				"demo_img.png",
			);
			await expect(fs.stat(movedPath)).resolves.toBeDefined();
		});
	});
});
