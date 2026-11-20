import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	buildLinkGraph,
	resolveTarget,
} from "../../src/shared/vault-ops/links.js";
import { scanVault } from "../../src/shared/vault-ops/scan.js";
import { cleanupFixtures, copyFixture } from "../helpers/fixture.js";
import { file, snapshotOf } from "../helpers/vaultOps.js";

afterEach(cleanupFixtures);

const paths = [
	"스터디/HTTP.md",
	"스터디/1주차/HTTP.md",
	"resume/자기소개서.md",
	"sunub/이력서/자기소개서.md",
	"스터디/세션.md".normalize("NFD"),
	"스터디/5주차/캡처 화면.png",
	"note.v2.md",
];

describe("resolveTarget", () => {
	test("유일한 파일명은 바로 해석된다", () => {
		expect(resolveTarget("세션", "wiki", "AI/LLM.md", paths)).toEqual({
			resolved: paths[4],
			ambiguous: false,
		});
	});

	test("같은 이름이 여럿이고 같은 폴더가 없으면 모호하다", () => {
		expect(
			resolveTarget("자기소개서", "wiki", "좋은코드/좋은코드-Base.md", paths),
		).toEqual({ resolved: "resume/자기소개서.md", ambiguous: true });
	});

	test("같은 폴더의 후보가 있으면 모호하지 않다", () => {
		expect(resolveTarget("HTTP", "wiki", "스터디/1주차/x.md", paths)).toEqual({
			resolved: "스터디/1주차/HTTP.md",
			ambiguous: false,
		});
	});

	test("대소문자가 달라도 해석된다", () => {
		expect(resolveTarget("http", "wiki", "스터디/x.md", paths).resolved).toBe(
			"스터디/HTTP.md",
		);
	});

	test("경로가 있는 대상은 경로 끝 일치로 찾는다", () => {
		expect(resolveTarget("1주차/HTTP", "wiki", "a.md", paths).resolved).toBe(
			"스터디/1주차/HTTP.md",
		);
	});

	test("확장자 판정은 알려진 확장자만 본다", () => {
		expect(resolveTarget("note.v2", "wiki", "a.md", paths).resolved).toBe(
			"note.v2.md",
		);
		expect(
			resolveTarget("캡처 화면.png", "embed", "a.md", paths).resolved,
		).toBe("스터디/5주차/캡처 화면.png");
	});

	test("마크다운 링크는 노트 기준 상대 경로를 먼저 본다", () => {
		expect(
			resolveTarget(
				"캡처%20화면.png",
				"markdown-embed",
				"스터디/5주차/CORS.md",
				paths,
			).resolved,
		).toBe("스터디/5주차/캡처 화면.png");
	});

	test("마크다운 링크는 상대 경로가 없으면 Vault 루트 기준을 본다", () => {
		expect(
			resolveTarget("/resume/자기소개서.md", "markdown", "스터디/x.md", paths),
		).toEqual({ resolved: "resume/자기소개서.md", ambiguous: false });
	});

	test("잘못된 퍼센트 인코딩은 예외 없이 원문으로 해석한다", () => {
		expect(resolveTarget("%E0.png", "markdown", "a.md", paths)).toEqual({
			resolved: null,
			ambiguous: false,
		});
	});

	test("없는 대상은 null이다", () => {
		expect(resolveTarget("없는노트", "wiki", "a.md", paths)).toEqual({
			resolved: null,
			ambiguous: false,
		});
	});
});

describe("buildLinkGraph", () => {
	test("note만 읽고 링크를 해석해 그래프를 만든다", async () => {
		const snap = snapshotOf(["a.md", "b.md", "c.png"].map((p) => file(p)));
		const read: string[] = [];
		const graph = await buildLinkGraph(snap, async (p) => {
			read.push(p);
			return p === "a.md" ? "[[b]] ![[c.png]] [[없음]]" : "";
		});
		expect(read.sort()).toEqual(["a.md", "b.md"]);
		expect(graph.outbound("a.md").map((r) => r.resolved)).toEqual([
			"b.md",
			"c.png",
			null,
		]);
		expect(graph.inbound("c.png")).toHaveLength(1);
	});

	test("fixture 전체 그래프의 깨진 링크는 [[없는노트]] 하나다", async () => {
		const root = await copyFixture();
		const snap = await scanVault(root);
		const graph = await buildLinkGraph(snap, (p) =>
			fs.readFile(path.join(root, p), "utf-8"),
		);
		expect(
			graph.refs.filter((r) => r.resolved === null).map((r) => r.target),
		).toEqual(["없는노트"]);
	});
});
