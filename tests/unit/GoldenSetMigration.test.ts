import { describe, expect, test } from "vitest";
import {
	applyJudgmentRecords,
	collectUnjudgedCandidates,
} from "../../scripts/eval/extract-unjudged.js";
import {
	mergeGradesIntoQuery,
	normalizeGoldenQuery,
} from "../../scripts/eval/lib/goldenSet.js";
import { attachRecoverableZeros } from "../../scripts/eval/migrate-golden-set.js";

describe("GoldenSet schema migration and unjudged workflow", () => {
	test("normalizes legacy relevant/relevant_lenient into unified grades map", () => {
		const normalized = normalizeGoldenQuery({
			id: "q1",
			type: "semantic",
			query: "test",
			relevant: ["a.md"],
			relevant_lenient: ["a.md", "b.md"],
		});

		expect(normalized.grades).toEqual({ "a.md": 2, "b.md": 1 });
		expect(normalized.relevant).toEqual(["a.md"]);
		expect(normalized.relevant_lenient).toEqual(["a.md", "b.md"]);
	});

	test("recovers confirmed zero grades without overriding existing positive labels", () => {
		const base = normalizeGoldenQuery({
			id: "d001",
			type: "keyword",
			query: "lancedb",
			relevant: ["a.md"],
			relevant_lenient: ["a.md", "b.md"],
		});
		const judged = new Map([["d001", new Set(["a.md", "b.md", "neg.md"])]]);

		const { migrated, recoveredZeroCount } = attachRecoverableZeros(
			[base],
			judged,
		);

		expect(recoveredZeroCount).toBe(1);
		expect(migrated[0]?.grades).toEqual({
			"a.md": 2,
			"b.md": 1,
			"neg.md": 0,
		});
		expect(migrated[0]?.relevant).toEqual(["a.md"]);
		expect(migrated[0]?.relevant_lenient).toEqual(["a.md", "b.md"]);
	});

	test("collects only unjudged top-k documents and merges new judgments back cleanly", () => {
		const query = mergeGradesIntoQuery(
			normalizeGoldenQuery({
				id: "b001",
				type: "semantic",
				query: "auth",
				relevant: ["auth.md"],
			}),
			{ "noise.md": 0 },
		);

		const rankings = new Map([
			["sysA", new Map([["auth", ["auth.md", "new1.md", "noise.md"]]])],
			["sysB", new Map([["auth", ["new1.md", "new2.md", "auth.md"]]])],
		]);

		const unjudged = collectUnjudgedCandidates([query], rankings, 3);
		expect(unjudged).toEqual([
			{
				id: "b001",
				type: "semantic",
				query: "auth",
				path: "new1.md",
				systems: ["sysA", "sysB"],
				bestRank: 1,
			},
			{
				id: "b001",
				type: "semantic",
				query: "auth",
				path: "new2.md",
				systems: ["sysB"],
				bestRank: 2,
			},
		]);

		const { updated, appliedCount } = applyJudgmentRecords(
			[query],
			[
				{ id: "b001", path: "new1.md", grade: 2 },
				{ id: "b001", path: "new2.md", grade: 0 },
			],
		);

		expect(appliedCount).toBe(2);
		expect(updated[0]?.grades).toEqual({
			"auth.md": 2,
			"new1.md": 2,
			"new2.md": 0,
			"noise.md": 0,
		});
		expect(updated[0]?.relevant).toEqual(["auth.md", "new1.md"]);
	});
});
