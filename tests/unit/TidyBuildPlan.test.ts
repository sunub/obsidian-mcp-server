import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	buildLinkGraph,
	DEFAULT_TIDY_OPTIONS,
	loadPlan,
	type PlanOp,
	scanVault,
} from "../../src/shared/vault-ops/index.js";
import {
	buildTidyPlan,
	TidyInputError,
} from "../../src/tools/tidy/buildPlan.js";
import { cleanupFixtures, copyFixture } from "../helpers/fixture.js";

afterEach(cleanupFixtures);

type Shape = {
	type: PlanOp["type"];
	path: string;
	to?: string;
	redirectTo?: string | null;
	tier: PlanOp["tier"];
};

function shapeOf(op: PlanOp): Shape {
	switch (op.type) {
		case "move":
			return { type: "move", path: op.from, to: op.to, tier: op.tier };
		case "trash":
			return {
				type: "trash",
				path: op.path,
				redirectTo: op.redirectTo,
				tier: op.tier,
			};
		case "removeEmptyFolder":
			return { type: "removeEmptyFolder", path: op.path, tier: op.tier };
		case "report":
			return { type: "report", path: op.paths[0] ?? "", tier: op.tier };
	}
}

function move(from: string, to: string): Shape {
	return { type: "move", path: from, to, tier: "bulk" };
}

function trash(path: string, redirectTo: string | null): Shape {
	return { type: "trash", path, redirectTo, tier: "per_item" };
}

function removeFolder(path: string): Shape {
	return { type: "removeEmptyFolder", path, tier: "bulk" };
}

const EXPECTED_ACTIONS: Shape[] = [
	move("database.png", "attachments/database.png"),
	move("images/좋은코드/1.png", "좋은코드/attachments/1.png"),
	move("스터디/첨부파일/methods.jpeg", "스터디/attachments/methods.jpeg"),
	move(
		"AI/빅분기/Pasted image 20260829123734.png",
		"AI/빅분기/attachments/Pasted image 20260829123734.png",
	),
	move(
		"스터디/Pasted image 1.png",
		"스터디/5주차/attachments/Pasted image 1.png",
	),
	move("스터디/5주차/캡처 화면.png", "스터디/5주차/attachments/캡처 화면.png"),
	move(
		"sunub/블로그/eventloop1.png",
		"sunub/블로그/attachments/eventloop1.png",
	),
	trash("스터디/HTTP.md", "스터디/1주차/HTTP.md"),
	trash("스터디/5주차/Pasted image 1.png", "스터디/Pasted image 1.png"),
	trash("무제.md", null),
	trash("좋은코드/무제.md", null),
	removeFolder("스터디/빈폴더"),
	removeFolder("AI/무제"),
];

const EXPECTED_REPORT_PATHS = [
	"스터디/shared.png",
	"orphan.png",
	"resume/무제 1.md",
	"빈최상위",
];

function touchedBy(op: PlanOp): string[] {
	if (op.type === "move") return [op.from, op.to];
	if (op.type === "report") return op.paths;
	return [op.path];
}

const tmpRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tmpRoots
			.splice(0)
			.map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

async function tmpVault(files: Record<string, string>): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "tidy-plan-"));
	tmpRoots.push(root);
	for (const [relative, content] of Object.entries(files)) {
		await fs.mkdir(path.dirname(path.join(root, relative)), {
			recursive: true,
		});
		await fs.writeFile(path.join(root, relative), content, "utf-8");
	}
	return root;
}

describe("buildTidyPlan: fixture 전체 계획", () => {
	test("EXPECTED.md의 B1~B4 행과 일치한다", async () => {
		const root = await copyFixture();

		const { plan } = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);

		const actions = plan.ops.filter((op) => op.type !== "report").map(shapeOf);
		expect(actions).toHaveLength(EXPECTED_ACTIONS.length);
		expect(actions).toEqual(expect.arrayContaining(EXPECTED_ACTIONS));
		const reportPaths = plan.ops
			.filter((op) => op.type === "report")
			.flatMap((op) => (op.type === "report" ? op.paths : []));
		for (const expected of EXPECTED_REPORT_PATHS) {
			expect(reportPaths).toContain(expected);
		}
		expect(plan.needsTitle.map((n) => n.path)).toEqual([
			"스터디/5주차/무제 2.md",
		]);
		expect(plan.source).toBe("tidy");
		expect(plan.scope).toBeNull();
	});

	test("앞선 플래너가 다룬 경로는 뒤 플래너가 다루지 않는다", async () => {
		const root = await tmpVault({
			"a/one.png": "same-bytes",
			"a/two.png": "same-bytes",
			"a/n.md": "![[one.png]]",
			"a/m.md": "![[two.png]]",
		});

		const attachmentsOnly = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS, [
			"attachments",
		]);
		const all = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);

		const shapes = all.plan.ops.map(shapeOf);
		const trashed = shapes.find((s) => s.type === "trash");
		expect(trashed).toBeDefined();
		const trashedPath = trashed?.path ?? "";
		const keptPath = trashed?.redirectTo ?? "";
		const attachmentMoves = attachmentsOnly.plan.ops
			.map(shapeOf)
			.filter((s) => s.type === "move");
		expect(attachmentMoves.map((s) => s.path)).toContain(trashedPath);
		expect(shapes.filter((s) => s.path === trashedPath)).toEqual([trashed]);
		expect(shapes.filter((s) => s.type === "move").map((s) => s.path)).toEqual([
			keptPath,
		]);
	});

	test("fixture에서 휴지통으로 가는 중복 이미지는 이동 연산을 갖지 않는다", async () => {
		const root = await copyFixture();

		const { plan } = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);

		const duplicate = "스터디/5주차/Pasted image 1.png";
		const actions = plan.ops
			.filter((op) => op.type !== "report")
			.map(shapeOf)
			.filter((s) => s.path === duplicate || s.to === duplicate);
		expect(actions.map((a) => a.type)).toEqual(["trash"]);
	});

	test("플래너 실행 순서는 요청 순서가 아니라 고정 순서다", async () => {
		const root = await copyFixture();

		const reversed = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS, [
			"emptyFolders",
			"attachments",
			"untitled",
			"duplicates",
		]);
		const all = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);

		expect(reversed.plan.ops.map(shapeOf)).toEqual(all.plan.ops.map(shapeOf));
	});

	test("지정한 플래너만 실행한다", async () => {
		const root = await copyFixture();

		const { plan } = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS, [
			"emptyFolders",
		]);

		expect(plan.ops.map(shapeOf)).toEqual(
			expect.arrayContaining([removeFolder("AI/무제")]),
		);
		expect(
			plan.ops.every(
				(op) => op.type === "removeEmptyFolder" || op.type === "report",
			),
		).toBe(true);
		expect(plan.needsTitle).toEqual([]);
	});
});

describe("buildTidyPlan: scope", () => {
	test("scope를 주면 그 최상위 폴더 연산만 남는다", async () => {
		const root = await copyFixture();

		const { plan, preview } = await buildTidyPlan(root, {
			...DEFAULT_TIDY_OPTIONS,
			scope: "스터디",
		});

		expect(plan.scope).toBe("스터디");
		expect(plan.ops.length).toBeGreaterThan(0);
		const touched = plan.ops.flatMap(touchedBy);
		for (const p of touched) expect(p.startsWith("스터디/")).toBe(true);
		expect(plan.needsTitle.map((n) => n.path)).toEqual([
			"스터디/5주차/무제 2.md",
		]);
		expect(preview.summary.needsTitle).toBe(1);
	});

	test("다른 폴더의 needsTitle은 scope 밖이면 걸러진다", async () => {
		const root = await copyFixture();

		const { plan } = await buildTidyPlan(root, {
			...DEFAULT_TIDY_OPTIONS,
			scope: "sunub",
		});

		expect(plan.needsTitle).toEqual([]);
		for (const op of plan.ops) {
			expect(JSON.stringify(op)).not.toContain("스터디/");
		}
	});

	test("빈 최상위 폴더의 report는 자기 이름을 scope로 받는다", async () => {
		const root = await copyFixture();

		const { plan } = await buildTidyPlan(root, {
			...DEFAULT_TIDY_OPTIONS,
			scope: "빈최상위",
		});

		expect(plan.ops.map((op) => op.type)).toEqual(["report"]);
	});

	test("없는 scope는 입력 오류", async () => {
		const root = await copyFixture();

		await expect(
			buildTidyPlan(root, { ...DEFAULT_TIDY_OPTIONS, scope: "없는폴더" }),
		).rejects.toBeInstanceOf(TidyInputError);
	});

	test("경로 문자가 든 scope는 입력 오류", async () => {
		const root = await copyFixture();

		for (const scope of ["../x", "스터디/5주차", "a\\b", ".."]) {
			await expect(
				buildTidyPlan(root, { ...DEFAULT_TIDY_OPTIONS, scope }),
			).rejects.toBeInstanceOf(TidyInputError);
		}
	});
});

describe("buildTidyPlan: 저장과 미리보기", () => {
	test("계획이 저장되어 loadPlan으로 읽힌다", async () => {
		const root = await copyFixture();

		const { plan, preview } = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);

		expect(plan.planId).toMatch(/^\d{8}-\d{6}-/);
		expect(preview.planId).toBe(plan.planId);
		expect(await loadPlan(root, plan.planId)).toEqual(plan);
	});

	test("미리보기는 단계별로 나뉘고 요약 수와 일치한다", async () => {
		const root = await copyFixture();

		const { plan, preview } = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);

		expect(preview.summary.bulk).toBe(preview.bulk.length);
		expect(preview.summary.per_item).toBe(preview.per_item.length);
		expect(preview.summary.report).toBe(preview.report.length);
		expect(
			preview.bulk.length + preview.per_item.length + preview.report.length,
		).toBe(plan.ops.length);
		expect(preview.needsTitle).toEqual(plan.needsTitle);
		expect(preview.bulk).toContainEqual({
			id: expect.any(String),
			type: "move",
			path: "database.png",
			to: "attachments/database.png",
			reason: expect.any(String),
		});
		expect(preview.per_item).toContainEqual({
			id: expect.any(String),
			type: "trash",
			path: "스터디/HTTP.md",
			redirectTo: "스터디/1주차/HTTP.md",
			reason: expect.any(String),
		});
		for (const view of preview.report) {
			expect(view.paths?.[0]).toBe(view.path);
		}
	});

	test("연산 ID는 계획마다 다른 접두사와 순번으로 짧게 붙는다", async () => {
		const root = await copyFixture();

		const first = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);
		const second = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);

		const suffix = first.plan.planId.slice(-4);
		expect(first.plan.ops.map((op) => op.id)).toEqual(
			first.plan.ops.map((_, index) => `${suffix}-${index + 1}`),
		);
		const secondIds = new Set(second.plan.ops.map((op) => op.id));
		expect(first.plan.ops.filter((op) => secondIds.has(op.id))).toEqual([]);
	});

	test("영향받는 링크 수는 옮기거나 지우는 파일을 가리키는 ref 수다", async () => {
		const root = await copyFixture();
		const { plan, preview } = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);
		const graph = await buildLinkGraph(await scanVault(root), (p) =>
			fs.readFile(path.join(root, p), "utf-8"),
		);

		const expected = plan.ops.reduce((sum, op) => {
			if (op.type === "move") return sum + graph.inbound(op.from).length;
			if (op.type === "trash") return sum + graph.inbound(op.path).length;
			return sum;
		}, 0);

		expect(expected).toBeGreaterThan(0);
		expect(preview.summary.linksAffected).toBe(expected);
	});

	test("fileHashes에는 옮기는 파일과 그것을 링크하는 노트의 해시가 든다", async () => {
		const root = await copyFixture();
		const snapshot = await scanVault(root);
		const hashOf = (p: string) =>
			snapshot.files.find((f) => f.path === p)?.hash;

		const { plan } = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);

		expect(plan.fileHashes["database.png"]).toBe(hashOf("database.png"));
		expect(plan.fileHashes["Docker.md"]).toBe(hashOf("Docker.md"));
		expect(plan.fileHashes["attachments/database.png"]).toBeUndefined();
		expect(plan.fileHashes["orphan.png"]).toBeUndefined();
	});

	test("정리할 것이 없으면 연산 0개", async () => {
		const root = await tmpVault({ "a/note.md": "내용이 있는 노트" });

		const { plan, preview } = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);

		expect(plan.ops).toEqual([]);
		expect(preview.summary).toEqual({
			bulk: 0,
			per_item: 0,
			report: 0,
			linksAffected: 0,
			needsTitle: 0,
		});
		expect(await loadPlan(root, plan.planId)).toEqual(plan);
	});
});
