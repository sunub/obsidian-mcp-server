import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { applyPlan } from "../../src/shared/vault-ops/apply.js";
import { pathKey } from "../../src/shared/vault-ops/ids.js";
import { readJournal } from "../../src/shared/vault-ops/journal.js";
import { buildLinkGraph } from "../../src/shared/vault-ops/links.js";
import { scanVault } from "../../src/shared/vault-ops/scan.js";
import type { PlanOp } from "../../src/shared/vault-ops/types.js";
import { cleanupFixtures, copyFixture } from "../helpers/fixture.js";
import {
	approveAll,
	FIXTURE_OPS,
	PLAN_ID,
	savedFixturePlan,
	UNTITLED_NOTE,
	vaultState,
} from "../helpers/messyPlan.js";

afterEach(cleanupFixtures);

function readerFor(root: string) {
	return (notePath: string) => fs.readFile(path.join(root, notePath), "utf-8");
}

async function graphOf(root: string) {
	return buildLinkGraph(await scanVault(root), readerFor(root));
}

async function exists(root: string, relative: string): Promise<boolean> {
	return fs
		.access(path.join(root, relative))
		.then(() => true)
		.catch(() => false);
}

function intendedTargets(ops: PlanOp[]) {
	const moves = new Map<string, string>();
	const redirects = new Map<string, string | null>();
	for (const op of ops) {
		if (op.type === "move") moves.set(op.from, op.to);
		if (op.type === "trash") redirects.set(op.path, op.redirectTo);
	}
	return { moves, redirects };
}

describe("applyPlan: fixture 전체 승인", () => {
	test("실행 후 깨진 링크는 [[없는노트]] 하나뿐이다", async () => {
		const root = await copyFixture();
		await savedFixturePlan(root);

		const result = await applyPlan(root, {
			planId: PLAN_ID,
			approvedOpIds: approveAll(FIXTURE_OPS),
			renames: [],
		});

		expect(result.rejected).toEqual([]);
		expect(result.applied).toHaveLength(FIXTURE_OPS.length);
		const broken = (await graphOf(root)).refs.filter(
			(ref) => ref.resolved === null,
		);
		expect(broken.map((ref) => ref.target)).toEqual(["없는노트"]);
	});

	test("모든 링크는 실행 전과 같은 파일을 가리킨다", async () => {
		const root = await copyFixture();
		await savedFixturePlan(root);
		const before = await graphOf(root);

		await applyPlan(root, {
			planId: PLAN_ID,
			approvedOpIds: approveAll(FIXTURE_OPS),
			renames: [],
		});
		const after = await graphOf(root);

		const { moves, redirects } = intendedTargets(FIXTURE_OPS);
		const afterByNote = new Map<string, typeof after.refs>();
		for (const ref of after.refs) {
			const key = pathKey(ref.from);
			afterByNote.set(key, [...(afterByNote.get(key) ?? []), ref]);
		}
		const beforeByNote = new Map<string, typeof before.refs>();
		for (const ref of before.refs) {
			beforeByNote.set(ref.from, [...(beforeByNote.get(ref.from) ?? []), ref]);
		}

		let checked = 0;
		for (const [note, refs] of beforeByNote) {
			if (redirects.has(note)) continue;
			const noteAfter = afterByNote.get(pathKey(moves.get(note) ?? note));
			expect(noteAfter, note).toBeDefined();
			refs.forEach((ref, index) => {
				if (ref.resolved === null) return;
				const intended = redirects.has(ref.resolved)
					? redirects.get(ref.resolved)
					: (moves.get(ref.resolved) ?? ref.resolved);
				const afterRef = noteAfter?.[index];
				expect(
					afterRef?.resolved === null || afterRef === undefined
						? null
						: pathKey(afterRef.resolved),
					`${note} #${index} ${ref.raw}`,
				).toBe(intended ? pathKey(intended) : null);
				checked += 1;
			});
		}
		expect(checked).toBeGreaterThan(5);
	});

	test("마크다운 링크는 옮겨진 첨부의 새 상대 경로로 바뀐다", async () => {
		const root = await copyFixture();
		await savedFixturePlan(root);

		await applyPlan(root, {
			planId: PLAN_ID,
			approvedOpIds: approveAll(FIXTURE_OPS),
			renames: [],
		});

		const cors = await fs.readFile(
			path.join(root, "스터디/5주차/CORS.md"),
			"utf-8",
		);
		expect(cors).toContain("![캡처](attachments/캡처%20화면.png)");
	});

	test("휴지통 이동은 .trash에 두고 이름이 겹치면 번호를 붙인다", async () => {
		const root = await copyFixture();
		await savedFixturePlan(root);

		await applyPlan(root, {
			planId: PLAN_ID,
			approvedOpIds: approveAll(FIXTURE_OPS),
			renames: [],
		});

		expect(await exists(root, ".trash/HTTP.md")).toBe(true);
		expect(await exists(root, ".trash/Pasted image 1.png")).toBe(true);
		expect(await exists(root, ".trash/무제.md")).toBe(true);
		expect(await exists(root, ".trash/무제 1.md")).toBe(true);
		expect(await exists(root, "스터디/HTTP.md")).toBe(false);
	});

	test("옮겨서 비게 된 폴더와 승인된 빈 폴더가 지워지고 최상위 폴더는 남는다", async () => {
		const root = await copyFixture();
		await savedFixturePlan(root);

		const result = await applyPlan(root, {
			planId: PLAN_ID,
			approvedOpIds: approveAll(FIXTURE_OPS),
			renames: [],
		});

		expect(result.removedFolders).toEqual(
			expect.arrayContaining([
				"스터디/빈폴더",
				"AI/무제",
				"AI/무제/안쪽",
				"images/좋은코드",
				"스터디/첨부파일",
			]),
		);
		expect(await exists(root, "images")).toBe(true);
		expect(await exists(root, "스터디/빈폴더")).toBe(false);
		expect(await exists(root, "AI/무제")).toBe(false);
	});
});

describe("applyPlan: 승인과 거부", () => {
	test("승인하지 않은 연산은 실행되지 않는다", async () => {
		const root = await copyFixture();
		await savedFixturePlan(root);

		const result = await applyPlan(root, {
			planId: PLAN_ID,
			approvedOpIds: ["move:database.png"],
			renames: [],
		});

		expect(result.applied).toEqual(["move:database.png"]);
		expect(await exists(root, "attachments/database.png")).toBe(true);
		expect(await exists(root, "orphan.png")).toBe(true);
		expect(await exists(root, "스터디/HTTP.md")).toBe(true);
		expect(await exists(root, "스터디/빈폴더")).toBe(true);
	});

	test("계획이 없으면 오류", async () => {
		const root = await copyFixture();
		await expect(
			applyPlan(root, { planId: "nope", approvedOpIds: [], renames: [] }),
		).rejects.toThrow("계획을 찾을 수 없음: nope");
	});

	test("검증을 통과하지 못한 연산은 rejected로 돌려주고 나머지는 실행한다", async () => {
		const root = await copyFixture();
		await savedFixturePlan(root);
		await fs.appendFile(
			path.join(root, "Docker.md"),
			"\n계획 이후 추가",
			"utf-8",
		);

		const result = await applyPlan(root, {
			planId: PLAN_ID,
			approvedOpIds: ["move:database.png", "move:images/좋은코드/1.png"],
			renames: [],
		});

		expect(result.rejected).toEqual([
			{ opId: "move:database.png", reason: "계획 이후 파일이 바뀜" },
		]);
		expect(result.applied).toEqual(["move:images/좋은코드/1.png"]);
		expect(await exists(root, "database.png")).toBe(true);
	});

	test("이름 변경은 needsTitle에 있는 경로만 받는다", async () => {
		const root = await copyFixture();
		await savedFixturePlan(root);

		const result = await applyPlan(root, {
			planId: PLAN_ID,
			approvedOpIds: [],
			renames: [
				{ path: "AI/LLM.md", title: "엘엘엠" },
				{ path: UNTITLED_NOTE, title: "CORS 심화: 정리?" },
			],
		});

		expect(result.rejected.map((r) => r.opId)).toEqual(["rename:AI/LLM.md"]);
		expect(await exists(root, "AI/LLM.md")).toBe(true);
		expect(await exists(root, "스터디/5주차/CORS 심화 정리.md")).toBe(true);
		expect(await exists(root, UNTITLED_NOTE)).toBe(false);
	});

	test("빈 제목은 거부한다", async () => {
		const root = await copyFixture();
		await savedFixturePlan(root);

		const result = await applyPlan(root, {
			planId: PLAN_ID,
			approvedOpIds: [],
			renames: [{ path: UNTITLED_NOTE, title: " ?/: " }],
		});

		expect(result.rejected).toEqual([
			{ opId: `rename:${UNTITLED_NOTE}`, reason: "제목이 비어 있음" },
		]);
		expect(await exists(root, UNTITLED_NOTE)).toBe(true);
	});
});

describe("applyPlan: 실행 기록", () => {
	test("중간에 실패해도 그때까지의 기록이 남는다", async () => {
		const root = await copyFixture();
		const ops: PlanOp[] = [
			{
				id: "move:AI/LLM.md",
				type: "move",
				from: "AI/LLM.md",
				to: "AI/정리/LLM.md",
				tier: "per_item",
				reason: "test",
			},
			{
				id: "move:AI/RAG.md",
				type: "move",
				from: "AI/RAG.md",
				to: "AI/읽기전용/RAG.md",
				tier: "per_item",
				reason: "test",
			},
		];
		await savedFixturePlan(root, ops);
		const readOnly = path.join(root, "AI/읽기전용");
		await fs.mkdir(readOnly);
		await fs.chmod(readOnly, 0o555);

		try {
			await expect(
				applyPlan(root, {
					planId: PLAN_ID,
					approvedOpIds: approveAll(ops),
					renames: [],
				}),
			).rejects.toThrow(/실행 중 오류/);
		} finally {
			await fs.chmod(readOnly, 0o755);
		}

		const [runFile] = await fs.readdir(path.join(root, ".vault-tidy/runs"));
		const journal = await readJournal(
			root,
			(runFile ?? "").replace(".json", ""),
		);
		expect(journal?.entries).toContainEqual(
			expect.objectContaining({
				kind: "move",
				from: "AI/LLM.md",
				to: "AI/정리/LLM.md",
			}),
		);
		expect(journal?.entries).not.toContainEqual(
			expect.objectContaining({ kind: "move", from: "AI/RAG.md" }),
		);
		expect(journal?.undoneAt).toBeNull();
	});

	test("실행 기록에 변경 전 내용과 변경 후 해시가 남는다", async () => {
		const root = await copyFixture();
		await savedFixturePlan(root);
		const before = await vaultState(root);

		const result = await applyPlan(root, {
			planId: PLAN_ID,
			approvedOpIds: approveAll(FIXTURE_OPS),
			renames: [],
		});

		const journal = await readJournal(root, result.runId);
		expect(journal?.planId).toBe(PLAN_ID);
		const rewrites = journal?.entries.filter((e) => e.kind === "rewrite") ?? [];
		expect(rewrites.length).toBeGreaterThan(0);
		const after = await vaultState(root);
		for (const entry of rewrites) {
			if (entry.kind !== "rewrite") continue;
			expect(after.hashes[entry.path]).toBe(entry.afterHash);
			expect(entry.before).not.toBe("");
		}
		expect(before.hashes).not.toEqual(after.hashes);
	});
});
