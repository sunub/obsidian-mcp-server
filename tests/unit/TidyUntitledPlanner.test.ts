import { describe, expect, test } from "vitest";
import { createLinkGraph } from "../../src/shared/vault-ops/graph.js";
import {
	DEFAULT_TIDY_OPTIONS,
	type LinkRef,
	type VaultFile,
} from "../../src/shared/vault-ops/types.js";
import { planUntitled } from "../../src/tools/tidy/planners/untitled.js";
import { file, link, notesReader, snapshotOf } from "../helpers/vaultOps.js";

function run(
	files: VaultFile[],
	contents: Record<string, string>,
	refs: LinkRef[] = [],
) {
	return planUntitled({
		snapshot: snapshotOf(files),
		graph: createLinkGraph(refs),
		options: DEFAULT_TIDY_OPTIONS,
		readNote: notesReader(contents),
	});
}

describe("planUntitled", () => {
	test("frontmatter만 있는 무제 노트는 비어 있다", async () => {
		const out = await run([file("좋은코드/무제.md")], {
			"좋은코드/무제.md": "---\ntags: []\n---\n",
		});
		expect(out.ops).toEqual([
			{
				id: "trash:좋은코드/무제.md",
				type: "trash",
				path: "좋은코드/무제.md",
				redirectTo: null,
				tier: "per_item",
				reason: "비어 있는 무제 노트",
			},
		]);
		expect(out.needsTitle).toEqual([]);
	});

	test("내용 있는 무제 노트는 needsTitle로 간다", async () => {
		const out = await run([file("AI/Untitled 2.md")], {
			"AI/Untitled 2.md": "---\ntags: []\n---\n# 메모\n\n내용",
		});
		expect(out.ops).toEqual([]);
		expect(out.needsTitle).toEqual([
			{ path: "AI/Untitled 2.md", preview: "# 메모 내용" },
		]);
	});

	test("링크된 빈 무제 노트는 report", async () => {
		const out = await run(
			[file("a/무제.md"), file("a/n.md")],
			{ "a/무제.md": "  \n", "a/n.md": "x" },
			[link("a/n.md", "무제", "a/무제.md")],
		);
		expect(out.ops).toEqual([
			{
				id: "report:untitled-linked:a/무제.md",
				type: "report",
				paths: ["a/무제.md"],
				tier: "report",
				reason: "비어 있지만 다른 노트가 링크함",
			},
		]);
	});

	test("닫히지 않은 frontmatter는 내용 있음", async () => {
		const out = await run([file("a/무제.md")], {
			"a/무제.md": "---\ntitle: 제목",
		});
		expect(out.ops).toEqual([]);
		expect(out.needsTitle).toHaveLength(1);
	});

	test("미리보기는 300자이고 공백이 한 칸", async () => {
		const out = await run([file("a/무제.md")], {
			"a/무제.md": `\n\n  ${"가  \n\n".repeat(400)}`,
		});
		expect(out.needsTitle[0].preview).toHaveLength(300);
		expect(out.needsTitle[0].preview).not.toMatch(/\s{2}/);
		expect(out.needsTitle[0].preview.startsWith("가 가")).toBe(true);
	});

	test("무제가 아닌 이름은 무시한다", async () => {
		const out = await run(
			[file("a/무제노트.md"), file("a/무제-1.md"), file("a/note.md")],
			{ "a/무제노트.md": "", "a/무제-1.md": "", "a/note.md": "" },
		);
		expect(out).toEqual({ ops: [], needsTitle: [] });
	});

	test("노트가 아닌 파일은 무시한다", async () => {
		const out = await run([file("a/무제.png")], {});
		expect(out).toEqual({ ops: [], needsTitle: [] });
	});

	test("경로 오름차순으로 처리한다", async () => {
		const out = await run([file("b/무제.md"), file("a/무제.md")], {
			"a/무제.md": "",
			"b/무제.md": "",
		});
		expect(out.ops.map((op) => op.id)).toEqual([
			"trash:a/무제.md",
			"trash:b/무제.md",
		]);
	});
});
