import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { Indexer } from "../../src/utils/Indexer";
import { Semaphore } from "../../src/utils/semaphore";

const TEST_DIR = path.join(process.cwd(), "test-vault-indexer");
const sem = new Semaphore(10);

async function writeDoc(
	filename: string,
	frontmatter: Record<string, unknown>,
	body: string,
) {
	const fmLines = Object.entries(frontmatter)
		.map(([k, v]) => {
			if (Array.isArray(v)) {
				return `${k}:\n${v.map((item) => `  - ${item}`).join("\n")}`;
			}
			return `${k}: ${v}`;
		})
		.join("\n");
	const content = `---\n${fmLines}\n---\n\n${body}`;
	await fs.writeFile(path.join(TEST_DIR, filename), content);
	return path.join(TEST_DIR, filename);
}

describe("Indexer", () => {
	let indexer: Indexer;

	beforeAll(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	afterEach(async () => {
		const files = await fs.readdir(TEST_DIR);
		await Promise.all(
			files.map((f) =>
				fs.rm(path.join(TEST_DIR, f), { recursive: true, force: true }),
			),
		);
	});

	test("build()는 파일을 인덱싱하고 documentMap에 저장한다", async () => {
		const p1 = await writeDoc(
			"note1.md",
			{ title: "First Note", tags: ["alpha", "beta"] },
			"Content of the first note.",
		);
		const p2 = await writeDoc(
			"note2.md",
			{ title: "Second Note", tags: ["gamma"] },
			"Content of the second note.",
		);

		indexer = new Indexer();
		await indexer.build([p1, p2], sem);

		expect(indexer.totalFiles).toBe(2);
		expect(indexer.getDocument(p1)).not.toBeNull();
		expect(indexer.getDocument(p2)).not.toBeNull();
	});

	test("getAllDocuments()는 인덱싱된 모든 문서를 반환한다", async () => {
		const p1 = await writeDoc("a.md", { title: "A" }, "Content A");
		const p2 = await writeDoc("b.md", { title: "B" }, "Content B");
		const p3 = await writeDoc("c.md", { title: "C" }, "Content C");

		indexer = new Indexer();
		await indexer.build([p1, p2, p3], sem);

		expect(indexer.getAllDocuments()).toHaveLength(3);
	});

	test("단일 키워드 검색이 동작한다", async () => {
		const p1 = await writeDoc(
			"typescript.md",
			{ title: "TypeScript Guide" },
			"TypeScript is a strongly typed language.",
		);
		const p2 = await writeDoc(
			"python.md",
			{ title: "Python Guide" },
			"Python is a dynamic language.",
		);

		indexer = new Indexer();
		await indexer.build([p1, p2], sem);

		const results = indexer.search("typescript");
		expect(results).toHaveLength(1);
		expect(results[0].filePath).toBe(p1);
	});

	test("다중 키워드 AND 검색: 모든 토큰을 포함하는 문서만 반환한다", async () => {
		const p1 = await writeDoc(
			"both.md",
			{ title: "Both Keywords" },
			"This note mentions serverless and optimization together.",
		);
		const p2 = await writeDoc(
			"only-serverless.md",
			{ title: "Serverless Only" },
			"This note is about serverless architecture.",
		);
		const p3 = await writeDoc(
			"only-optimization.md",
			{ title: "Optimization Only" },
			"This note is about optimization strategies.",
		);

		indexer = new Indexer();
		await indexer.build([p1, p2, p3], sem);

		const results = indexer.search("serverless optimization");
		expect(results).toHaveLength(1);
		expect(results[0].filePath).toBe(p1);
	});

	test("다중 키워드 AND 검색: 매칭 문서가 없으면 빈 배열을 반환한다", async () => {
		const p1 = await writeDoc(
			"note.md",
			{ title: "Some Note" },
			"Contains only the word alpha.",
		);

		indexer = new Indexer();
		await indexer.build([p1], sem);

		const results = indexer.search("alpha nonexistent");
		expect(results).toEqual([]);
	});

	test("태그로 검색이 가능하다", async () => {
		const p1 = await writeDoc(
			"tagged.md",
			{ title: "Tagged", tags: ["obsidian", "productivity"] },
			"Some content",
		);

		indexer = new Indexer();
		await indexer.build([p1], sem);

		const results = indexer.search("obsidian");
		expect(results).toHaveLength(1);
		expect(results[0].filePath).toBe(p1);
	});

	test("제목(title)으로 검색이 가능하다", async () => {
		const p1 = await writeDoc(
			"meeting.md",
			{ title: "Weekly Standup Meeting" },
			"Agenda items...",
		);

		indexer = new Indexer();
		await indexer.build([p1], sem);

		const results = indexer.search("standup");
		expect(results).toHaveLength(1);
	});

	test("검색은 대소문자를 구분하지 않는다", async () => {
		const p1 = await writeDoc(
			"case.md",
			{ title: "CamelCase" },
			"Some UPPERCASE and lowercase text.",
		);

		indexer = new Indexer();
		await indexer.build([p1], sem);

		expect(indexer.search("uppercase")).toHaveLength(1);
		expect(indexer.search("UPPERCASE")).toHaveLength(1);
		expect(indexer.search("Uppercase")).toHaveLength(1);
	});

	test("빈 키워드나 공백만 입력하면 빈 배열을 반환한다", async () => {
		const p1 = await writeDoc("any.md", { title: "Any" }, "Content");
		indexer = new Indexer();
		await indexer.build([p1], sem);

		expect(indexer.search("")).toEqual([]);
		expect(indexer.search("   ")).toEqual([]);
	});

	test("존재하지 않는 키워드를 검색하면 빈 배열을 반환한다", async () => {
		const p1 = await writeDoc("doc.md", { title: "Doc" }, "Real content");
		indexer = new Indexer();
		await indexer.build([p1], sem);

		expect(indexer.search("xyznonexistent")).toEqual([]);
	});

	test("clear()는 모든 인덱스를 초기화한다", async () => {
		const p1 = await writeDoc("temp.md", { title: "Temp" }, "Data");
		indexer = new Indexer();
		await indexer.build([p1], sem);

		expect(indexer.totalFiles).toBe(1);

		indexer.clear();
		expect(indexer.totalFiles).toBe(0);
		expect(indexer.getAllDocuments()).toEqual([]);
		expect(indexer.search("temp")).toEqual([]);
	});

	test("getBacklinks()는 역방향 문서 링크를 반환한다", async () => {
		const p1 = await writeDoc(
			"target.md",
			{ title: "Target" },
			"# Target Document",
		);
		const p2 = await writeDoc(
			"source.md",
			{ title: "Source" },
			"This links to [[target]].",
		);

		indexer = new Indexer();
		await indexer.build([p1, p2], sem);

		const backlinks = indexer.getBacklinks(p1);
		expect(backlinks).toHaveLength(1);
		expect(backlinks[0]).toBe(p2);
	});

	test("getBacklinks()는 백링크가 없으면 빈 배열을 반환한다", async () => {
		const p1 = await writeDoc(
			"lonely.md",
			{ title: "Lonely" },
			"No one links to me.",
		);

		indexer = new Indexer();
		await indexer.build([p1], sem);

		expect(indexer.getBacklinks(p1)).toEqual([]);
	});

	test("헤더(#) 텍스트도 인덱싱되어 검색 가능하다", async () => {
		const p1 = await writeDoc(
			"headers.md",
			{ title: "Headers" },
			"# Introduction\n\n## Architecture Overview\n\nSome body text.",
		);

		indexer = new Indexer();
		await indexer.build([p1], sem);

		const results = indexer.search("architecture overview");
		expect(results).toHaveLength(1);
	});

	test("파일명으로도 검색이 가능하다", async () => {
		const p1 = await writeDoc(
			"my-special-note.md",
			{ title: "Different Title" },
			"Content here.",
		);

		indexer = new Indexer();
		await indexer.build([p1], sem);

		const results = indexer.search("my-special-note");
		expect(results).toHaveLength(1);
	});

	test("한글 콘텐츠도 토큰화되어 검색된다", async () => {
		const p1 = await writeDoc(
			"korean.md",
			{ title: "한글 문서" },
			"옵시디언 볼트에서 메모를 관리합니다.",
		);

		indexer = new Indexer();
		await indexer.build([p1], sem);

		const results = indexer.search("옵시디언");
		expect(results).toHaveLength(1);
	});
});
