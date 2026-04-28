import { describe, expect, test } from "vitest";
import { parse } from "@/utils/processor/MatterParser";

const DUMMY_FILE = "/vault/test-note.md";
const DUMMY_BIRTH = "2025-01-01T00:00:00.000Z";

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
		const result = parse(DUMMY_FILE, DUMMY_BIRTH, text);

		expect(result.frontmatter.title).toBe("My Note");
		expect(result.frontmatter.tags).toEqual(["typescript", "mcp"]);
		expect(result.frontmatter.summary).toBe("A short summary");
		expect(result.frontmatter.slug).toBe("my-note");
		expect(result.frontmatter.category).toBe("web");
		expect(result.frontmatter.completed).toBe(true);
		expect(result.content).toContain("# Body content here");
	});

	test("frontmatter가 없는 문서는 fallback으로 처리된다", () => {
		const text = "# Just a heading\n\nSome paragraph text.";
		const result = parse(DUMMY_FILE, DUMMY_BIRTH, text);

		// title이 필수 필드이므로 catch 블록의 fallback이 실행됩니다.
		expect(result.frontmatter.title).toBe("test-note");
		expect(result.frontmatter.tags).toEqual([""]);
		expect(result.content).toBe(text);
	});

	test("빈 frontmatter(--- 만 있는 경우)를 fallback으로 처리한다", () => {
		const text = `---
---

Content after empty frontmatter.`;
		const result = parse(DUMMY_FILE, DUMMY_BIRTH, text);

		// title 누락으로 catch 블록 fallback이 실행됩니다.
		expect(result.frontmatter.title).toBe("test-note");
		expect(result.frontmatter.tags).toEqual([""]);
		expect(result.content).toContain("Content after empty frontmatter.");
	});

	test("부분적인 frontmatter를 처리한다 (title만 존재)", () => {
		const text = `---
title: Only Title
---

Rest of the content.`;
		const result = parse(DUMMY_FILE, DUMMY_BIRTH, text);

		expect(result.frontmatter.title).toBe("Only Title");
		expect(result.frontmatter.tags).toBeUndefined();
		expect(result.frontmatter.summary).toBeUndefined();
		expect(result.content).toContain("Rest of the content.");
	});

	test("스키마에 정의되지 않은 필드도 유지(passthrough)된다", () => {
		const text = `---
title: Test
unknownField: some value
anotherRandom: 42
---

Content`;
		const result = parse(DUMMY_FILE, DUMMY_BIRTH, text);

		expect(result.frontmatter.title).toBe("Test");
		expect(result.frontmatter).toHaveProperty("unknownField", "some value");
		expect(result.frontmatter).toHaveProperty("anotherRandom", 42);
	});

	test("빈 문자열을 처리한다", () => {
		const result = parse(DUMMY_FILE, DUMMY_BIRTH, "");

		// title 누락으로 catch 블록 fallback이 실행됩니다.
		expect(result.frontmatter.title).toBe("test-note");
		expect(result.content).toBe("");
	});

	test("tags가 빈 배열이어도 처리한다", () => {
		const text = `---
title: Empty Tags
tags: []
---

Content`;
		const result = parse(DUMMY_FILE, DUMMY_BIRTH, text);

		expect(result.frontmatter.title).toBe("Empty Tags");
		expect(result.frontmatter.tags).toEqual([]);
	});

	test("date 필드가 문자열과 Date 객체 모두 수용된다", () => {
		const text = `---
title: Date Test
date: 2025-06-15
---

Content`;
		const result = parse(DUMMY_FILE, DUMMY_BIRTH, text);

		// gray-matter가 Date 객체로 파싱할 수 있으므로, 둘 다 허용
		expect(result.frontmatter.date).toBeDefined();
	});

	test("category 필드의 유효한 값을 검증한다", () => {
		const validCategories = ["web", "algorithm", "cs", "code"];
		for (const cat of validCategories) {
			const text = `---\ntitle: Test\ncategory: ${cat}\n---\nContent`;
			const result = parse(DUMMY_FILE, DUMMY_BIRTH, text);
			expect(result.frontmatter.category).toBe(cat);
		}
	});

	test("잘못된 category 값은 content가 반환된다", () => {
		const text = `---
title: Test
category: invalid_category
---

Content`;
		const result = parse(DUMMY_FILE, DUMMY_BIRTH, text);
		expect(result.content).toBeDefined();
	});

	test("completed 필드가 boolean으로 파싱된다", () => {
		const trueText = `---\ntitle: Done\ncompleted: true\n---\nDone`;
		const falseText = `---\ntitle: Not Done\ncompleted: false\n---\nNot done`;

		expect(parse(DUMMY_FILE, DUMMY_BIRTH, trueText).frontmatter.completed).toBe(
			true,
		);
		expect(
			parse(DUMMY_FILE, DUMMY_BIRTH, falseText).frontmatter.completed,
		).toBe(false);
	});
});
