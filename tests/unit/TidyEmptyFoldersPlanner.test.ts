import { describe, expect, test } from "vitest";
import { createLinkGraph } from "../../src/shared/vault-ops/graph.js";
import { DEFAULT_TIDY_OPTIONS } from "../../src/shared/vault-ops/types.js";
import { planEmptyFolders } from "../../src/tools/tidy/planners/empty-folders.js";
import { file, notesReader, snapshotOf } from "../helpers/vaultOps.js";

function run(emptyFolders: string[], files = [file("AI/LLM.md")]) {
	return planEmptyFolders({
		snapshot: snapshotOf(files, { emptyFolders }),
		graph: createLinkGraph([]),
		options: DEFAULT_TIDY_OPTIONS,
		readNote: notesReader({}),
	});
}

describe("planEmptyFolders", () => {
	test("가장 바깥 빈 하위 폴더만 지운다", async () => {
		const { ops, needsTitle } = await run([
			"AI/무제",
			"AI/무제/안쪽",
			"스터디/빈폴더",
		]);
		expect(needsTitle).toEqual([]);
		expect(ops).toEqual([
			{
				id: "removeEmptyFolder:AI/무제",
				type: "removeEmptyFolder",
				path: "AI/무제",
				tier: "bulk",
				reason: "비어 있는 폴더",
			},
			expect.objectContaining({
				type: "removeEmptyFolder",
				path: "스터디/빈폴더",
			}),
		]);
	});

	test("빈 최상위 폴더는 report만", async () => {
		const { ops } = await run(["빈최상위", "빈최상위/안"]);
		expect(ops).toEqual([
			{
				id: "report:empty-top:빈최상위",
				type: "report",
				paths: ["빈최상위"],
				tier: "report",
				reason: "비어 있는 최상위 폴더",
			},
		]);
	});

	test("중간 폴더가 비어 있지 않아도 바깥 빈 폴더 안의 것은 뺀다", async () => {
		const { ops } = await run(["a", "a/b/c"]);
		expect(ops.map((op) => op.type)).toEqual(["report"]);
	});

	test("빈 폴더가 없으면 연산이 없다", async () => {
		expect(await run([])).toEqual({ ops: [], needsTitle: [] });
	});
});
