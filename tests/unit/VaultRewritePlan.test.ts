import { describe, expect, test } from "vitest";
import { buildLinkGraph } from "../../src/shared/vault-ops/links.js";
import { computeRewrites } from "../../src/shared/vault-ops/rewritePlan.js";
import { file, notesReader, snapshotOf } from "../helpers/vaultOps.js";

type Scenario = {
	notes: Record<string, string>;
	extraFiles?: string[];
	moves?: Record<string, string>;
	trashed?: Record<string, string | null>;
};

async function rewritesFor(scenario: Scenario) {
	const moves = new Map(Object.entries(scenario.moves ?? {}));
	const trashed = new Map(Object.entries(scenario.trashed ?? {}));
	const paths = [
		...Object.keys(scenario.notes),
		...(scenario.extraFiles ?? []),
	];
	const emptyNotes = Object.fromEntries(
		(scenario.extraFiles ?? []).map((p) => [p, ""]),
	);
	const readNote = notesReader({ ...emptyNotes, ...scenario.notes });
	const graph = await buildLinkGraph(
		snapshotOf(paths.map((p) => file(p))),
		readNote,
	);
	const pathsAfter = paths
		.filter((p) => !trashed.has(p))
		.map((p) => moves.get(p) ?? p);
	return computeRewrites({ graph, moves, trashed, pathsAfter, readNote });
}

describe("computeRewrites", () => {
	test("옮긴 이미지의 이름이 여전히 유일하면 임베드를 그대로 둔다", async () => {
		const result = await rewritesFor({
			notes: { "n.md": "![[methods.jpeg|300]]" },
			extraFiles: ["a/methods.jpeg"],
			moves: { "a/methods.jpeg": "a/attachments/methods.jpeg" },
		});
		expect(result).toEqual([]);
	});

	test("옮긴 이미지의 이름이 모호해지면 경로로 바꾸고 suffix를 유지한다", async () => {
		const result = await rewritesFor({
			notes: { "n.md": "앞 ![[methods.jpeg|300]] 뒤" },
			extraFiles: ["a/methods.jpeg", "b/methods.jpeg"],
			moves: { "a/methods.jpeg": "a/attachments/methods.jpeg" },
		});
		expect(result).toEqual([
			{
				notePathAfter: "n.md",
				before: "앞 ![[methods.jpeg|300]] 뒤",
				after: "앞 ![[a/attachments/methods.jpeg|300]] 뒤",
				count: 1,
			},
		]);
	});

	test("옮긴 노트 안의 상대 경로 마크다운 링크가 고쳐진다", async () => {
		const result = await rewritesFor({
			notes: { "a/x.md": "[t](../b.md)", "b.md": "" },
			moves: { "a/x.md": "a/sub/x.md" },
		});
		expect(result).toEqual([
			{
				notePathAfter: "a/sub/x.md",
				before: "[t](../b.md)",
				after: "[t](../../b.md)",
				count: 1,
			},
		]);
	});

	test("옮긴 첨부를 가리키는 마크다운 링크는 새 상대 경로로 바뀐다", async () => {
		const result = await rewritesFor({
			notes: { "s/CORS.md": "![캡처](캡처%20화면.png)" },
			extraFiles: ["s/캡처 화면.png"],
			moves: { "s/캡처 화면.png": "s/attachments/캡처 화면.png" },
		});
		expect(result.map((r) => r.after)).toEqual([
			"![캡처](attachments/캡처%20화면.png)",
		]);
	});

	test("이동과 무관한 마크다운 링크는 건드리지 않는다", async () => {
		const result = await rewritesFor({
			notes: { "a/n.md": "[x](foo.png)" },
			extraFiles: ["z/foo.png", "q/other.png"],
			moves: { "q/other.png": "q/attachments/other.png" },
		});
		expect(result).toEqual([]);
	});

	test("이동 때문에 이름이 모호해지면 전체 경로로 바꾼다", async () => {
		const result = await rewritesFor({
			notes: { "x/n.md": "[[dup]]" },
			extraFiles: ["x/dup.md", "y/dup.md"],
			moves: { "x/dup.md": "x/sub/dup.md" },
		});
		expect(result.map((r) => r.after)).toEqual(["[[x/sub/dup]]"]);
	});

	test("휴지통으로 가는 파일의 링크는 redirectTo로 바뀐다", async () => {
		const result = await rewritesFor({
			notes: { "n.md": "[[스터디/HTTP]] 참고" },
			extraFiles: ["스터디/HTTP.md", "스터디/1주차/HTTP.md"],
			trashed: { "스터디/HTTP.md": "스터디/1주차/HTTP.md" },
		});
		expect(result.map((r) => r.after)).toEqual(["[[HTTP]] 참고"]);
	});

	test("redirectTo가 함께 옮겨지면 새 위치를 가리킨다", async () => {
		const result = await rewritesFor({
			notes: { "n.md": "[[a/old]]" },
			extraFiles: ["a/old.md", "a/keep.md", "b/keep.md"],
			trashed: { "a/old.md": "a/keep.md" },
			moves: { "a/keep.md": "a/sub/keep.md" },
		});
		expect(result.map((r) => r.after)).toEqual(["[[a/sub/keep]]"]);
	});

	test("깨진 링크는 건드리지 않는다", async () => {
		const result = await rewritesFor({
			notes: { "n.md": "[[없는노트]]", "a.md": "" },
			moves: { "a.md": "s/a.md" },
		});
		expect(result).toEqual([]);
	});

	test("휴지통으로 가는 노트의 링크는 다시 쓰지 않는다", async () => {
		const result = await rewritesFor({
			notes: { "gone.md": "[[x/dup]]" },
			extraFiles: ["x/dup.md", "y/dup.md"],
			trashed: { "gone.md": null },
			moves: { "x/dup.md": "x/sub/dup.md" },
		});
		expect(result).toEqual([]);
	});

	test("한 노트의 여러 링크는 뒤에서부터 바꿔 위치가 밀리지 않는다", async () => {
		const content = "[[dup]] 그리고 [[dup|별칭]] 끝";
		const result = await rewritesFor({
			notes: { "x/n.md": content },
			extraFiles: ["x/dup.md", "y/dup.md"],
			moves: { "x/dup.md": "x/sub/dup.md" },
		});
		expect(result).toEqual([
			{
				notePathAfter: "x/n.md",
				before: content,
				after: "[[x/sub/dup]] 그리고 [[x/sub/dup|별칭]] 끝",
				count: 2,
			},
		]);
	});

	test("옮겨진 노트는 새 위치로 보고한다", async () => {
		const result = await rewritesFor({
			notes: { "x/n.md": "[[dup]]" },
			extraFiles: ["x/dup.md", "q/dup.md"],
			moves: { "x/n.md": "x/sub/n.md" },
		});
		expect(result).toEqual([
			{
				notePathAfter: "x/sub/n.md",
				before: "[[dup]]",
				after: "[[x/dup]]",
				count: 1,
			},
		]);
	});
});
