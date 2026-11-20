import { describe, expect, test } from "vitest";
import { createLinkGraph } from "../../src/shared/vault-ops/graph.js";
import {
	DEFAULT_TIDY_OPTIONS,
	type LinkRef,
	type PlannerContext,
	type VaultFile,
} from "../../src/shared/vault-ops/types.js";
import { planAttachments } from "../../src/tools/tidy/planners/attachments.js";
import { file, link, notesReader, snapshotOf } from "../helpers/vaultOps.js";

function contextOf(
	files: VaultFile[],
	refs: LinkRef[],
	options = DEFAULT_TIDY_OPTIONS,
): PlannerContext {
	return {
		snapshot: snapshotOf(files),
		graph: createLinkGraph(refs),
		options,
		readNote: notesReader({}),
	};
}

describe("planAttachments", () => {
	test("루트 images 폴더의 이미지는 참조하는 노트 옆으로 돌아간다", async () => {
		const { ops, needsTitle } = await planAttachments(
			contextOf(
				[file("images/좋은코드/1.png"), file("좋은코드/좋은코드-Base.md")],
				[
					link(
						"좋은코드/좋은코드-Base.md",
						"images/좋은코드/1.png",
						"images/좋은코드/1.png",
						{ form: "embed" },
					),
				],
			),
		);
		expect(needsTitle).toEqual([]);
		expect(ops).toEqual([
			expect.objectContaining({
				type: "move",
				from: "images/좋은코드/1.png",
				to: "좋은코드/attachments/1.png",
				tier: "bulk",
				id: "move:images/좋은코드/1.png",
			}),
		]);
	});

	test("루트 노트가 참조하면 루트 attachments로 간다", async () => {
		const { ops } = await planAttachments(
			contextOf(
				[file("img/a.png"), file("note.md")],
				[link("note.md", "a.png", "img/a.png")],
			),
		);
		expect(ops).toEqual([
			expect.objectContaining({ type: "move", to: "attachments/a.png" }),
		]);
	});

	test("첨부파일 폴더는 같은 위치의 attachments로 바뀐다", async () => {
		const { ops } = await planAttachments(
			contextOf(
				[file("스터디/첨부파일/methods.jpeg"), file("스터디/1주차/노트.md")],
				[
					link(
						"스터디/1주차/노트.md",
						"methods.jpeg",
						"스터디/첨부파일/methods.jpeg",
					),
				],
			),
		);
		expect(ops).toEqual([
			expect.objectContaining({
				type: "move",
				from: "스터디/첨부파일/methods.jpeg",
				to: "스터디/attachments/methods.jpeg",
			}),
		]);
	});

	test("이미 attachments 폴더에 있으면 연산이 없다", async () => {
		const { ops } = await planAttachments(
			contextOf(
				[file("AI/attachments/a.png"), file("AI/노트.md")],
				[link("AI/노트.md", "a.png", "AI/attachments/a.png")],
			),
		);
		expect(ops).toEqual([]);
	});

	test("참조하는 노트가 없으면 report", async () => {
		const { ops } = await planAttachments(contextOf([file("img/a.png")], []));
		expect(ops).toEqual([
			expect.objectContaining({
				type: "report",
				paths: ["img/a.png"],
				reason: "참조하는 노트가 없음",
				id: "report:attachments:img/a.png",
			}),
		]);
	});

	test("canvas만 참조하는 이미지는 이동하지 않고 report", async () => {
		const { ops } = await planAttachments(
			contextOf([file("img/a.png"), file("board.canvas")], []),
		);
		expect(ops.map((op) => op.type)).toEqual(["report"]);
	});

	test("최상위 폴더가 다른 노트들이 함께 쓰면 report", async () => {
		const { ops } = await planAttachments(
			contextOf(
				[file("스터디/shared.png"), file("스터디/a.md"), file("AI/b.md")],
				[
					link("스터디/a.md", "shared.png", "스터디/shared.png"),
					link("AI/b.md", "shared.png", "스터디/shared.png"),
				],
			),
		);
		expect(ops).toEqual([
			expect.objectContaining({
				type: "report",
				reason: "서로 다른 최상위 폴더의 노트가 함께 사용",
			}),
		]);
	});

	test("루트 노트와 폴더 노트가 함께 쓰면 report", async () => {
		const { ops } = await planAttachments(
			contextOf(
				[file("x.png"), file("root.md"), file("AI/b.md")],
				[link("root.md", "x.png", "x.png"), link("AI/b.md", "x.png", "x.png")],
			),
		);
		expect(ops.map((op) => op.type)).toEqual(["report"]);
	});

	test("같은 이미지를 두 번 참조해도 연산은 하나다", async () => {
		const { ops } = await planAttachments(
			contextOf(
				[file("img/a.png"), file("AI/n.md")],
				[
					link("AI/n.md", "a.png", "img/a.png"),
					link("AI/n.md", "a.png", "img/a.png", { form: "embed" }),
				],
			),
		);
		expect(ops).toHaveLength(1);
	});

	test("이동 후 같은 이름이 되면 두 번째는 report", async () => {
		const { ops } = await planAttachments(
			contextOf(
				[file("a/1.png"), file("b/1.png"), file("n.md")],
				[
					link("n.md", "a/1.png", "a/1.png"),
					link("n.md", "b/1.png", "b/1.png"),
				],
			),
		);
		expect(ops).toEqual([
			expect.objectContaining({ type: "move", from: "a/1.png" }),
			expect.objectContaining({
				type: "report",
				paths: ["b/1.png"],
				reason: "목적지에 같은 이름의 파일이 있음",
			}),
		]);
	});

	test("목적지에 이미 다른 파일이 있으면 report", async () => {
		const { ops } = await planAttachments(
			contextOf(
				[file("img/1.png"), file("AI/attachments/1.PNG"), file("AI/n.md")],
				[link("AI/n.md", "1.png", "img/1.png")],
			),
		);
		expect(ops).toEqual([
			expect.objectContaining({ type: "report" }),
			expect.objectContaining({ type: "report" }),
		]);
	});

	test("첨부 폴더 이름 옵션을 따른다", async () => {
		const { ops } = await planAttachments(
			contextOf(
				[
					file("스터디/첨부파일/m.jpeg"),
					file("AI/img/b.png"),
					file("AI/n.md"),
					file("스터디/n.md"),
				],
				[
					link("스터디/n.md", "m.jpeg", "스터디/첨부파일/m.jpeg"),
					link("AI/n.md", "b.png", "AI/img/b.png"),
				],
				{ ...DEFAULT_TIDY_OPTIONS, attachmentsFolderName: "assets" },
			),
		);
		expect(ops).toEqual([
			expect.objectContaining({ to: "AI/assets/b.png" }),
			expect.objectContaining({ to: "스터디/assets/m.jpeg" }),
		]);
	});
});
