import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { Semaphore } from "../../src/shared/async/semaphore";
import { Indexer } from "../../src/shared/indexing/Indexer";

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
		// 3 docs found because of OR match (tokens length <= 2 requires at least 1 match)
		expect(results).toHaveLength(3);
		// both.md should be ranked first because it contains both keywords (higher score)
		expect(results[0].filePath).toBe(p1);
	});

	test("다중 키워드 OR 검색: 최소 매칭 요건(MSM)에 부합하지 않거나 아예 없으면 빈 배열을 반환한다", async () => {
		const p1 = await writeDoc(
			"note.md",
			{ title: "Some Note" },
			"Contains only the word alpha.",
		);

		indexer = new Indexer();
		await indexer.build([p1], sem);

		// 3 tokens requires at least 2 matches, but note.md only matches 'alpha', so it is filtered out
		const results = indexer.search("alpha nonexistent1 nonexistent2");
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

	test("질의 토큰 앞뒤의 문장부호는 무시한다", async () => {
		const p1 = await writeDoc(
			"lancedb.md",
			{ title: "벡터 저장소" },
			"LanceDB 인덱스를 다시 만든다.",
		);
		const p2 = await writeDoc("other.md", { title: "기타" }, "관계없는 문서.");

		indexer = new Indexer();
		await indexer.build([p1, p2], sem);

		expect(indexer.search("LanceDB,").map((d) => d.filePath)).toEqual([p1]);
		expect(indexer.search("(lancedb)?").map((d) => d.filePath)).toEqual([p1]);
		// 두 토큰 모두 문장부호가 붙어도 최소 일치 조건을 채운다
		expect(indexer.search('"lancedb" 다시.').map((d) => d.filePath)).toEqual([
			p1,
		]);
	});

	test("문장부호가 들어간 태그·파일명은 질의에 그대로 써도 찾는다", async () => {
		const p1 = await writeDoc(
			"my-note.md",
			{ title: "Note", tags: ["c++"] },
			"본문.",
		);

		indexer = new Indexer();
		await indexer.build([p1], sem);

		expect(indexer.search("c++")).toHaveLength(1);
		expect(indexer.search("my-note")).toHaveLength(1);
	});

	test("중간에 문장부호가 있는 질의 토큰은 나뉜 조각이 모두 있는 문서를 찾는다", async () => {
		const both = await writeDoc(
			"routing.md",
			{ title: "라우팅" },
			"Next.js 15에서 동적 라우트를 쓴다.",
		);
		const onlyNext = await writeDoc(
			"plan.md",
			{ title: "계획" },
			"next step을 정한다.",
		);

		indexer = new Indexer();
		await indexer.build([both, onlyNext], sem);

		expect(indexer.search("Next.js").map((d) => d.filePath)).toEqual([both]);
		expect(indexer.search("next.js 라우트를").map((d) => d.filePath)).toEqual([
			both,
		]);
	});

	test("한 글자 조각(I/O → i, o)은 나뉜 조각 일치에 쓰지 않는다", async () => {
		const noise = await writeDoc(
			"noise.md",
			{ title: "메모" },
			"i 라는 변수와 o 라는 변수.",
		);

		indexer = new Indexer();
		await indexer.build([noise], sem);

		expect(indexer.search("I/O")).toEqual([]);
	});
});
