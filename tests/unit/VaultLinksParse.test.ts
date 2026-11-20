import { describe, expect, test } from "vitest";
import { parseLinks } from "../../src/shared/vault-ops/links.js";

describe("parseLinks", () => {
	test("위키 링크의 제목과 별칭은 suffix로 분리된다", () => {
		const [l] = parseLinks("AI/RAG.md", "[[LLM#개요|LLM 개요]]");
		expect(l).toMatchObject({
			form: "wiki",
			target: "LLM",
			suffix: "#개요|LLM 개요",
			start: 0,
		});
	});

	test("블록 참조와 별칭도 suffix다", () => {
		const [l] = parseLinks("a.md", "[[노트^abc|별칭]]");
		expect(l).toMatchObject({ target: "노트", suffix: "^abc|별칭" });
	});

	test("임베드 크기는 suffix다", () => {
		const [l] = parseLinks("a.md", "![[methods.jpeg|300]]");
		expect(l).toMatchObject({
			form: "embed",
			target: "methods.jpeg",
			suffix: "|300",
		});
	});

	test("마크다운 링크는 대상과 앵커를 나눈다", () => {
		const [l] = parseLinks("a.md", "[설명](old.md#앵커)");
		expect(l).toMatchObject({
			form: "markdown",
			target: "old.md",
			suffix: "#앵커",
		});
	});

	test("마크다운 이미지 링크는 인코딩된 대상을 그대로 둔다", () => {
		const [l] = parseLinks("a.md", "![캡처](캡처%20화면.png)");
		expect(l).toMatchObject({
			form: "markdown-embed",
			target: "캡처%20화면.png",
			suffix: "",
		});
	});

	test("코드 블록과 인라인 코드 안은 파싱하지 않는다", () => {
		const md = "```\n[[가짜]]\n```\n~~~\n[[가짜2]]\n~~~\n`[[가짜3]]` [[진짜]]";
		expect(parseLinks("a.md", md).map((l) => l.target)).toEqual(["진짜"]);
	});

	test("닫히지 않은 코드 블록은 문서 끝까지 제외한다", () => {
		expect(parseLinks("a.md", "[[앞]]\n```\n[[뒤]]")).toHaveLength(1);
	});

	test("외부 URL과 앵커 전용 링크는 파싱하지 않는다", () => {
		expect(
			parseLinks("a.md", "[x](https://a.b) [y](mailto:a@b) [z](#top)"),
		).toEqual([]);
	});

	test("같은 링크가 두 번 나오면 위치가 다르다", () => {
		const ls = parseLinks("a.md", "[[A]] [[A]]");
		expect(ls.map((l) => l.start)).toEqual([0, 6]);
	});

	test("raw는 content.slice(start, end)와 같고 원문 순서를 따른다", () => {
		const md = "앞 ![[a.png|10]] 중간 [x](b.md#h) 뒤 [[c]]";
		const ls = parseLinks("n.md", md);
		expect(ls.map((l) => l.target)).toEqual(["a.png", "b.md", "c"]);
		for (const l of ls) {
			expect(md.slice(l.start, l.end)).toBe(l.raw);
			expect(l.from).toBe("n.md");
		}
	});
});
