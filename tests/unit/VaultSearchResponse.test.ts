import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { localEmbedder } from "../../src/shared/local-ai/Embedder.js";
import { VaultManager } from "../../src/shared/vault-manager/VaultManager.js";
import type { ObsidianContentQueryParams } from "../../src/tools/vault/params.js";
import {
	readSpecificFile,
	searchDocuments,
} from "../../src/tools/vault/utils.js";

type SearchDocument = {
	path: string;
	title?: string;
	tags: string[];
	snippet?: string;
};

type SearchPayload = {
	query: string;
	search_status: { mode: string };
	found: number;
	documents: SearchDocument[];
	hint?: string;
};

function textOf(result: CallToolResult): string {
	const first = result.content?.[0];
	if (!first || first.type !== "text") {
		throw new Error("Expected text content in tool result");
	}
	return first.text;
}

describe("vault search 응답", () => {
	let vault: string;

	beforeEach(async () => {
		vault = await mkdtemp(join(tmpdir(), "vault-search-"));
		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(false);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(vault, { recursive: true, force: true });
	});

	const write = async (path: string, content: string) => {
		await mkdir(dirname(join(vault, path)), { recursive: true });
		await writeFile(join(vault, path), content, "utf-8");
	};

	const writeMatches = async (count: number) => {
		for (let i = 0; i < count; i++) {
			await write(
				`study/note-${i}.md`,
				`---\ntitle: 노트 ${i}\ntags: [study]\n---\n빅분기 ${"공부 기록 ".repeat(80)}\n`,
			);
		}
	};

	const search = async (
		params: Omit<ObsidianContentQueryParams, "action">,
		manager = new VaultManager(vault),
	) => {
		const text = textOf(
			await searchDocuments(manager, { action: "search", ...params }),
		);
		return { text, payload: JSON.parse(text) as SearchPayload };
	};

	const stubResult = async (
		matchedContent: string,
		keywordText: string | null,
	) => {
		await write("a.md", "본문\n");
		const manager = new VaultManager(vault);
		await manager.initialize();
		const [document] = await manager.getAllDocuments();
		if (!document) throw new Error("document was not indexed");
		vi.spyOn(manager, "hybridSearch").mockResolvedValue({
			results: [
				{
					score: 1,
					finalScore: 1,
					document,
					matchedChunks: [
						{
							id: "a",
							filePath: document.filePath,
							fileName: "a.md",
							chunkIndex: 0,
							content: matchedContent,
							metadata: {} as never,
						},
					],
					keywordText,
				},
			],
			search_status: { mode: "hybrid" },
		});
		return manager;
	};

	test("일치하는 문서를 기본 limit인 10건까지 모두 돌려준다", async () => {
		await writeMatches(15);

		const { payload } = await search({ keyword: "빅분기" });

		expect(payload.documents).toHaveLength(10);
		expect(payload.found).toBe(10);
	});

	test("limit만큼 돌려주고 compressionMode와 maxOutputChars로 줄이지 않는다", async () => {
		await writeMatches(15);

		const { payload } = await search({
			keyword: "빅분기",
			limit: 15,
			compressionMode: "summary",
			maxOutputChars: 500,
		});

		expect(payload.documents).toHaveLength(15);
	});

	test("문서마다 상대 경로, 제목, 태그, 일치 조각만 담는다", async () => {
		await writeMatches(1);

		const { payload } = await search({ keyword: "빅분기" });

		expect(Object.keys(payload)).toEqual([
			"query",
			"search_status",
			"found",
			"documents",
			"hint",
		]);
		expect(payload.documents[0]).toEqual({
			path: "study/note-0.md",
			title: "노트 0",
			tags: ["study"],
			snippet: expect.stringContaining("빅분기"),
		});
	});

	test("태그가 없는 문서는 빈 태그 목록을 돌려준다", async () => {
		await write("plain.md", "빅분기 메모\n");
		await write("blank.md", '---\ntags: [""]\n---\n빅분기 메모\n');

		const { payload } = await search({ keyword: "빅분기" });

		expect(payload.documents.map((document) => document.tags)).toEqual([
			[],
			[],
		]);
	});

	test("들여쓰기와 본문 자리 안내문 없이 보낸다", async () => {
		await writeMatches(2);

		const { text, payload } = await search({ keyword: "빅분기" });

		expect(text).not.toContain("\n");
		expect(text).not.toContain("Content not loaded");
		expect(payload.hint).toContain("action='read'");
	});

	test("돌려준 경로를 read의 filename에 그대로 쓸 수 있다", async () => {
		const decomposed = "자격증/빅분기 정리.md".normalize("NFD");
		await write(decomposed, "빅분기 내용\n");
		const manager = new VaultManager(vault);

		const { payload } = await search({ keyword: "빅분기" }, manager);
		const read = await readSpecificFile(manager, {
			action: "read",
			filename: payload.documents[0]?.path ?? "",
			compressionMode: "none",
		});

		expect(read.isError).toBe(false);
		expect(textOf(read)).toContain("빅분기 내용");
	});

	test("파일명으로만 일치하면 일치 조각을 생략한다", async () => {
		await write("빅분기-분석.md", "통계 기법 정리\n");

		const { payload } = await search({ keyword: "빅분기" });

		expect(payload.documents[0]).not.toHaveProperty("snippet");
	});

	test("긴 단락 뒤쪽의 검색어도 200자 이내 조각에 담는다", async () => {
		await write(
			"long.md",
			`${"가나다라 ".repeat(60)}빅분기를 준비했다 ${"마바사아 ".repeat(20)}\n`,
		);

		const { payload } = await search({ keyword: "빅분기와" });
		const snippet = payload.documents[0]?.snippet ?? "";

		expect(snippet).toContain("빅분기를");
		expect(snippet.length).toBeLessThanOrEqual(200);
	});

	test("의미 검색 조각에 검색어가 없으면 키워드 조각을 쓴다", async () => {
		const manager = await stubResult("제목만 있는 조각", "빅분기 시험 일정");

		const { payload } = await search({ keyword: "빅분기" }, manager);

		expect(payload.documents[0]?.snippet).toBe("빅분기 시험 일정");
	});

	test("검색어가 어디에도 없으면 의미 검색 조각의 앞부분을 담는다", async () => {
		const manager = await stubResult(
			`데이터\n분석 ${"설명 ".repeat(200)}`,
			null,
		);

		const { payload } = await search({ keyword: "빅분기" }, manager);
		const snippet = payload.documents[0]?.snippet ?? "";

		expect(snippet.startsWith("데이터 분석 설명")).toBe(true);
		expect(snippet.length).toBeLessThanOrEqual(200);
	});

	test("일치하는 문서가 없으면 빈 목록만 돌려준다", async () => {
		await writeMatches(1);

		const { payload } = await search({ keyword: "존재하지않는검색어" });

		expect(payload.found).toBe(0);
		expect(payload.documents).toEqual([]);
		expect(payload).not.toHaveProperty("hint");
	});
});
