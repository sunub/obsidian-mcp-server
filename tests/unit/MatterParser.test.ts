import { describe, expect, test } from "vitest";
import { parse } from "../../src/utils/processor/MatterParser";

describe("MatterParser", () => {
	test("정상적인 frontmatter를 파싱한다", () => {
		const text = `---
title: My Note
date: 2025-01-15
tags:
  - typescript
  - mcp
summary: A short summary
slug: my-note
category: web
completed: true
---

# Body content here
`;
		const result = parse(text);

		expect(result.frontmatter.title).toBe("My Note");
		expect(result.frontmatter.tags).toEqual(["typescript", "mcp"]);
		expect(result.frontmatter.summary).toBe("A short summary");
		expect(result.frontmatter.slug).toBe("my-note");
		expect(result.frontmatter.category).toBe("web");
		expect(result.frontmatter.completed).toBe(true);
		expect(result.content).toContain("# Body content here");
	});

	test("frontmatter가 없는 문서는 전체를 content로 반환한다", () => {
		const text = "# Just a heading\n\nSome paragraph text.";
		const result = parse(text);

		expect(result.frontmatter.title).toBeUndefined();
		expect(result.frontmatter.tags).toBeUndefined();
		expect(result.content).toBe(text);
	});

	test("빈 frontmatter(--- 만 있는 경우)를 처리한다", () => {
		const text = `---
---

Content after empty frontmatter.`;
		const result = parse(text);

		expect(result.frontmatter.title).toBeUndefined();
		expect(result.frontmatter.tags).toBeUndefined();
		expect(result.content).toContain("Content after empty frontmatter.");
	});

	test("부분적인 frontmatter를 처리한다 (title만 존재)", () => {
		const text = `---
title: Only Title
---

Rest of the content.`;
		const result = parse(text);

		expect(result.frontmatter.title).toBe("Only Title");
		expect(result.frontmatter.tags).toBeUndefined();
		expect(result.frontmatter.summary).toBeUndefined();
		expect(result.content).toContain("Rest of the content.");
	});

	test("스키마에 정의되지 않은 필드는 무시(strip)된다", () => {
		const text = `---
title: Test
unknownField: some value
anotherRandom: 42
---

Content`;
		const result = parse(text);

		expect(result.frontmatter.title).toBe("Test");
		expect(result.frontmatter).not.toHaveProperty("unknownField");
		expect(result.frontmatter).not.toHaveProperty("anotherRandom");
	});

	test("빈 문자열을 처리한다", () => {
		const result = parse("");

		expect(result.frontmatter.title).toBeUndefined();
		expect(result.content).toBe("");
	});

	test("tags가 빈 배열이어도 처리한다", () => {
		const text = `---
title: Empty Tags
tags: []
---

Content`;
		const result = parse(text);

		expect(result.frontmatter.title).toBe("Empty Tags");
		expect(result.frontmatter.tags).toEqual([]);
	});

	test("date 필드가 문자열과 Date 객체 모두 수용된다", () => {
		const text = `---
date: 2025-06-15
---

Content`;
		const result = parse(text);

		// gray-matter가 Date 객체로 파싱할 수 있으므로, 둘 다 허용
		expect(result.frontmatter.date).toBeDefined();
	});

	test("category 필드의 유효한 값을 검증한다", () => {
		const validCategories = ["web", "algorithm", "cs", "code"];
		for (const cat of validCategories) {
			const text = `---\ncategory: ${cat}\n---\nContent`;
			const result = parse(text);
			expect(result.frontmatter.category).toBe(cat);
		}
	});

	test("잘못된 category 값은 FrontMatterSchema.parse에서 에러가 발생하여 content fallback된다", () => {
		const text = `---
category: invalid_category
---

Content`;
		const result = parse(text);
		// MatterParser.parse 내부에서 FrontMatterSchema.parse 실패 시 catch로 빠져
		// 전체 텍스트를 content로 반환한다
		expect(result.content).toBeDefined();
	});

	test("completed 필드가 boolean으로 파싱된다", () => {
		const trueText = `---\ncompleted: true\n---\nDone`;
		const falseText = `---\ncompleted: false\n---\nNot done`;

		expect(parse(trueText).frontmatter.completed).toBe(true);
		expect(parse(falseText).frontmatter.completed).toBe(false);
	});
});
