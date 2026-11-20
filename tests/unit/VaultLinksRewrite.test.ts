import { describe, expect, test } from "vitest";
import {
	linkTargetFor,
	parseLinks,
	resolveTarget,
	rewriteLink,
} from "../../src/shared/vault-ops/links.js";
import type { LinkForm } from "../../src/shared/vault-ops/types.js";

describe("linkTargetFor", () => {
	test("파일명이 유일하면 파일명만 쓴다", () => {
		expect(
			linkTargetFor(
				"좋은코드/attachments/1.png",
				"좋은코드/좋은코드-Base.md",
				"embed",
				["좋은코드/attachments/1.png"],
			),
		).toBe("1.png");
	});

	test("파일명이 모호하면 전체 경로를 쓰고 노트는 .md를 뗀다", () => {
		expect(
			linkTargetFor("sunub/이력서/자기소개서.md", "a.md", "wiki", [
				"resume/자기소개서.md",
				"sunub/이력서/자기소개서.md",
			]),
		).toBe("sunub/이력서/자기소개서");
	});

	test("노트의 파일명만 쓸 때도 .md를 뗀다", () => {
		expect(
			linkTargetFor("스터디/HTTP.md", "a.md", "wiki", ["스터디/HTTP.md"]),
		).toBe("HTTP");
	});

	test("마크다운 링크는 상대 경로에 공백만 인코딩한다", () => {
		expect(
			linkTargetFor(
				"스터디/5주차/attachments/캡처 화면.png",
				"스터디/5주차/CORS.md",
				"markdown-embed",
				[],
			),
		).toBe("attachments/캡처%20화면.png");
	});

	test("마크다운 링크는 상위 폴더로 올라가는 상대 경로도 만든다", () => {
		expect(linkTargetFor("x/b.md", "a/c/n.md", "markdown", [])).toBe(
			"../../x/b.md",
		);
	});
});

describe("rewriteLink", () => {
	test("suffix와 텍스트를 유지한다", () => {
		const [w] = parseLinks("a.md", "![[methods.jpeg|300]]");
		expect(rewriteLink(w, "attachments/methods.jpeg")).toBe(
			"![[attachments/methods.jpeg|300]]",
		);
		const [m] = parseLinks("a.md", "[설명 텍스트](old.md#앵커)");
		expect(rewriteLink(m, "new.md")).toBe("[설명 텍스트](new.md#앵커)");
		const [e] = parseLinks("a.md", "![캡처](old.png)");
		expect(rewriteLink(e, "x/new.png")).toBe("![캡처](x/new.png)");
	});
});

describe("다시 쓴 링크의 왕복", () => {
	const targetPath = "스터디/5주차/attachments/캡처 화면.png";
	const from = "스터디/5주차/CORS.md";
	const paths = [targetPath, "다른곳/캡처 화면.png", from];
	const originals: Record<LinkForm, string> = {
		wiki: "[[old#제목|별칭]]",
		embed: "![[old.png|300]]",
		markdown: "[텍스트](old.md#앵커)",
		"markdown-embed": "![대체](old.png)",
	};

	test.each(
		Object.keys(originals) as LinkForm[],
	)("%s 형태는 다시 파싱하면 같은 대상으로 해석된다", (form) => {
		const [original] = parseLinks(from, originals[form]);
		const newTarget = linkTargetFor(targetPath, from, form, paths);
		const rewritten = rewriteLink(original, newTarget);
		const [reparsed] = parseLinks(from, rewritten);
		expect(reparsed.form).toBe(form);
		expect(reparsed.suffix).toBe(original.suffix);
		expect(resolveTarget(reparsed.target, reparsed.form, from, paths)).toEqual({
			resolved: targetPath,
			ambiguous: false,
		});
	});
});
