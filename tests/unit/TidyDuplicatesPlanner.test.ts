import { describe, expect, test } from "vitest";
import { createLinkGraph } from "../../src/shared/vault-ops/graph.js";
import {
	DEFAULT_TIDY_OPTIONS,
	type LinkRef,
	type VaultFile,
} from "../../src/shared/vault-ops/types.js";
import { planDuplicates } from "../../src/tools/tidy/planners/duplicates.js";
import { file, link, notesReader, snapshotOf } from "../helpers/vaultOps.js";

function run(
	files: VaultFile[],
	contents: Record<string, string> = {},
	refs: LinkRef[] = [],
) {
	return planDuplicates({
		snapshot: snapshotOf(files),
		graph: createLinkGraph(refs),
		options: DEFAULT_TIDY_OPTIONS,
		readNote: notesReader(contents),
	});
}

describe("planDuplicates", () => {
	test("참조 수가 같으면 더 깊은 경로를 남긴다", async () => {
		const { ops, needsTitle } = await run(
			[
				file("스터디/HTTP.md", { hash: "x" }),
				file("스터디/1주차/HTTP.md", { hash: "x" }),
			],
			{ "스터디/HTTP.md": "본문", "스터디/1주차/HTTP.md": "본문" },
		);
		expect(needsTitle).toEqual([]);
		expect(ops).toEqual([
			{
				id: "trash:스터디/HTTP.md",
				type: "trash",
				path: "스터디/HTTP.md",
				redirectTo: "스터디/1주차/HTTP.md",
				tier: "per_item",
				reason: "내용이 같은 파일이 스터디/1주차/HTTP.md에 있음",
			},
		]);
	});

	test("참조 수가 깊이보다 우선한다", async () => {
		const { ops } = await run(
			[
				file("스터디/HTTP.md", { hash: "x" }),
				file("스터디/1주차/HTTP.md", { hash: "x" }),
				file("AI/n.md"),
			],
			{
				"스터디/HTTP.md": "본문",
				"스터디/1주차/HTTP.md": "본문",
				"AI/n.md": "a",
			},
			[link("AI/n.md", "HTTP", "스터디/HTTP.md")],
		);
		expect(ops).toEqual([
			expect.objectContaining({
				path: "스터디/1주차/HTTP.md",
				redirectTo: "스터디/HTTP.md",
			}),
		]);
	});

	test("깊이도 같으면 최근 수정본을 남긴다", async () => {
		const { ops } = await run(
			[
				file("a/x.md", { hash: "x", mtimeMs: 1 }),
				file("b/x.md", { hash: "x", mtimeMs: 2 }),
			],
			{ "a/x.md": "본문", "b/x.md": "본문" },
		);
		expect(ops).toEqual([
			expect.objectContaining({ path: "a/x.md", redirectTo: "b/x.md" }),
		]);
	});

	test("전부 같으면 경로 사전순으로 앞선 것을 남긴다", async () => {
		const { ops } = await run(
			[file("b/x.md", { hash: "x" }), file("a/x.md", { hash: "x" })],
			{ "a/x.md": "본문", "b/x.md": "본문" },
		);
		expect(ops).toEqual([
			expect.objectContaining({ path: "b/x.md", redirectTo: "a/x.md" }),
		]);
	});

	test("세 개 중복은 하나만 남기고 둘을 trash", async () => {
		const { ops } = await run([
			file("a.png", { hash: "p" }),
			file("b/a.png", { hash: "p" }),
			file("b/c/a.png", { hash: "p" }),
		]);
		expect(ops.map((op) => op.type === "trash" && op.path)).toEqual([
			"a.png",
			"b/a.png",
		]);
		expect(
			ops.every((op) => op.type === "trash" && op.redirectTo === "b/c/a.png"),
		).toBe(true);
	});

	test("빈 파일과 공백뿐인 노트는 묶지 않는다", async () => {
		const { ops } = await run(
			[
				file("a.md", { hash: "e", size: 0 }),
				file("b.md", { hash: "e", size: 0 }),
				file("c.md", { hash: "w", size: 3 }),
				file("d.md", { hash: "w", size: 3 }),
			],
			{ "c.md": " \n\t", "d.md": " \n\t" },
		);
		expect(ops).toEqual([]);
	});

	test("이름 같고 내용 다르면 report", async () => {
		const { ops } = await run(
			[file("a/HTTP.md", { hash: "1" }), file("b/http.md", { hash: "2" })],
			{ "a/HTTP.md": "하나", "b/http.md": "둘" },
		);
		expect(ops).toEqual([
			{
				id: "report:same-name:http.md",
				type: "report",
				paths: ["a/HTTP.md", "b/http.md"],
				tier: "report",
				reason: "이름은 같고 내용이 다른 노트",
			},
		]);
	});

	test("무제 이름은 같은 이름 알림에서 뺀다", async () => {
		const { ops } = await run(
			[file("a/무제.md", { hash: "1" }), file("b/무제.md", { hash: "2" })],
			{ "a/무제.md": "하나", "b/무제.md": "둘" },
		);
		expect(ops).toEqual([]);
	});
});
