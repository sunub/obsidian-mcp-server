import { describe, expect, test } from "vitest";
import { checkMoveBoundary } from "../../src/shared/vault-ops/boundary.js";
import { createLinkGraph } from "../../src/shared/vault-ops/graph.js";
import type {
	ChangePlan,
	LinkRef,
	PlanOp,
} from "../../src/shared/vault-ops/types.js";
import { validateOps } from "../../src/shared/vault-ops/validate.js";
import { file, link, snapshotOf } from "../helpers/vaultOps.js";

const CROSS_FOLDER = "최상위 폴더 경계를 넘는 이동";

function move(from: string, to: string, id = `move:${from}`): PlanOp {
	return { id, type: "move", from, to, tier: "bulk", reason: "test" };
}

function trash(
	path: string,
	redirectTo: string | null = null,
	id = `trash:${path}`,
): PlanOp {
	return {
		id,
		type: "trash",
		path,
		redirectTo,
		tier: "per_item",
		reason: "test",
	};
}

function removeFolder(path: string): PlanOp {
	return {
		id: `removeEmptyFolder:${path}`,
		type: "removeEmptyFolder",
		path,
		tier: "bulk",
		reason: "test",
	};
}

function planOf(fileHashes: Record<string, string> = {}): ChangePlan {
	return {
		planId: "p1",
		createdAt: "2026-11-20T00:00:00.000Z",
		source: "tidy",
		scope: null,
		ops: [],
		needsTitle: [],
		fileHashes,
	};
}

function validate(
	ops: PlanOp[],
	options: {
		files?: string[];
		emptyFolders?: string[];
		refs?: LinkRef[];
		fileHashes?: Record<string, string>;
		hashes?: Record<string, string>;
	} = {},
) {
	const files = (options.files ?? []).map((p) =>
		file(p, options.hashes?.[p] ? { hash: options.hashes[p] } : {}),
	);
	return validateOps({
		ops,
		plan: planOf(options.fileHashes),
		snapshot: snapshotOf(files, { emptyFolders: options.emptyFolders }),
		graph: createLinkGraph(options.refs ?? []),
	});
}

describe("checkMoveBoundary", () => {
	test("Vault 밖이나 제외 폴더로 가는 이동은 거부한다", () => {
		for (const to of [
			"../a.md",
			"a/../../b.md",
			".trash/a.md",
			".obsidian/a.md",
		]) {
			expect(
				checkMoveBoundary({
					from: "sunub/a.md",
					to,
					kind: "note",
					referencingNotes: [],
				}),
			).toBe(CROSS_FOLDER);
		}
	});

	test("루트 파일은 어느 최상위 폴더로든 옮길 수 있다", () => {
		expect(
			checkMoveBoundary({
				from: "무제.md",
				to: "sunub/무제.md",
				kind: "note",
				referencingNotes: [],
			}),
		).toBeNull();
	});

	test("노트는 최상위 폴더를 넘지 못한다", () => {
		expect(
			checkMoveBoundary({
				from: "sunub/a.md",
				to: "resume/a.md",
				kind: "note",
				referencingNotes: [],
			}),
		).toBe(CROSS_FOLDER);
	});

	test("노트는 같은 최상위 폴더 안에서 움직일 수 있다", () => {
		expect(
			checkMoveBoundary({
				from: "sunub/a.md",
				to: "sunub/sub/a.md",
				kind: "note",
				referencingNotes: [],
			}),
		).toBeNull();
	});

	test("첨부는 참조하는 노트가 모두 같은 최상위 폴더면 따라간다", () => {
		expect(
			checkMoveBoundary({
				from: "images/좋은코드/1.png",
				to: "좋은코드/attachments/1.png",
				kind: "attachment",
				referencingNotes: ["좋은코드/좋은코드-Base.md"],
			}),
		).toBeNull();
	});

	test("첨부는 참조하는 노트가 다른 폴더에도 있으면 따라가지 못한다", () => {
		expect(
			checkMoveBoundary({
				from: "images/shared.png",
				to: "스터디/attachments/shared.png",
				kind: "attachment",
				referencingNotes: ["스터디/a.md", "AI/b.md"],
			}),
		).toBe(CROSS_FOLDER);
	});

	test("루트 노트만 참조하는 첨부는 루트의 첨부 폴더로 따라간다", () => {
		expect(
			checkMoveBoundary({
				from: "images/좋은코드는어떻게작성해야하나/1.png",
				to: "attachments/1.png",
				kind: "attachment",
				referencingNotes: ["좋은코드는어떻게작성해야하나.md"],
			}),
		).toBeNull();
	});

	test("루트 노트와 폴더 노트가 함께 참조하면 루트 첨부 폴더로 가지 못한다", () => {
		expect(
			checkMoveBoundary({
				from: "images/a/1.png",
				to: "attachments/1.png",
				kind: "attachment",
				referencingNotes: ["a.md", "스터디/b.md"],
			}),
		).toBe(CROSS_FOLDER);
	});

	test("루트 노트만 참조해도 다른 폴더의 첨부 폴더로는 가지 못한다", () => {
		expect(
			checkMoveBoundary({
				from: "images/a/1.png",
				to: "스터디/attachments/1.png",
				kind: "attachment",
				referencingNotes: ["a.md"],
			}),
		).toBe(CROSS_FOLDER);
	});

	test("참조가 없는 첨부는 다른 최상위 폴더로 갈 수 없다", () => {
		expect(
			checkMoveBoundary({
				from: "images/a.png",
				to: "스터디/a.png",
				kind: "attachment",
				referencingNotes: [],
			}),
		).toBe(CROSS_FOLDER);
	});
});

describe("validateOps", () => {
	test("경계를 넘는 이동은 거부한다", () => {
		const result = validate([move("sunub/a.md", "resume/a.md")], {
			files: ["sunub/a.md"],
		});
		expect(result.accepted).toEqual([]);
		expect(result.rejected).toEqual([
			{ opId: "move:sunub/a.md", reason: CROSS_FOLDER },
		]);
	});

	test("첨부 이동은 링크하는 노트를 기준으로 경계를 판단한다", () => {
		const result = validate([move("images/a/1.png", "a/attachments/1.png")], {
			files: ["images/a/1.png", "a/note.md"],
			refs: [link("a/note.md", "1.png", "images/a/1.png")],
		});
		expect(result.rejected).toEqual([]);
		expect(result.accepted).toHaveLength(1);
	});

	test("계획 이후 파일이 바뀌면 거부한다", () => {
		const result = validate([move("a/x.md", "a/sub/x.md")], {
			files: ["a/x.md"],
			hashes: { "a/x.md": "new" },
			fileHashes: { "a/x.md": "old" },
		});
		expect(result.rejected).toEqual([
			{ opId: "move:a/x.md", reason: "계획 이후 파일이 바뀜" },
		]);
	});

	test("연산 대상을 링크하는 노트가 바뀌어도 거부한다", () => {
		const result = validate([move("a/x.png", "a/attachments/x.png")], {
			files: ["a/x.png", "a/n.md"],
			hashes: { "a/n.md": "new" },
			fileHashes: { "a/n.md": "old", "a/x.png": "h:a/x.png" },
			refs: [link("a/n.md", "x.png", "a/x.png")],
		});
		expect(result.rejected).toEqual([
			{ opId: "move:a/x.png", reason: "계획 이후 파일이 바뀜" },
		]);
	});

	test("원본 파일이 없으면 거부한다", () => {
		const result = validate([move("a/gone.md", "a/b/gone.md")], {
			files: ["a/other.md"],
		});
		expect(result.rejected).toEqual([
			{ opId: "move:a/gone.md", reason: "원본 파일이 없음" },
		]);
	});

	test("목적지에 파일이 있으면 거부한다", () => {
		const result = validate([move("a/x.md", "a/y.md")], {
			files: ["a/x.md", "a/y.md"],
		});
		expect(result.rejected).toEqual([
			{ opId: "move:a/x.md", reason: "목적지에 파일이 있음" },
		]);
	});

	test("목적지 비교는 대소문자와 유니코드 정규화를 무시한다", () => {
		const result = validate([move("a/x.md", "a/Y.md")], {
			files: ["a/x.md", "a/y.md"],
		});
		expect(result.rejected).toHaveLength(1);
	});

	test("두 연산의 목적지가 같으면 둘 다 거부한다", () => {
		const result = validate(
			[move("a/x/n.md", "a/n.md"), move("a/y/n.md", "a/n.md")],
			{ files: ["a/x/n.md", "a/y/n.md"] },
		);
		expect(result.accepted).toEqual([]);
		expect(result.rejected.map((r) => r.reason)).toEqual([
			"다른 연산과 목적지가 겹침",
			"다른 연산과 목적지가 겹침",
		]);
	});

	test("링크가 남아 있는 파일은 redirectTo 없이 휴지통으로 보낼 수 없다", () => {
		const result = validate([trash("a/dup.md")], {
			files: ["a/dup.md", "a/n.md"],
			refs: [link("a/n.md", "dup", "a/dup.md")],
		});
		expect(result.rejected).toEqual([
			{
				opId: "trash:a/dup.md",
				reason: "링크가 남아 있어 휴지통으로 보낼 수 없음",
			},
		]);
	});

	test("redirectTo가 있으면 링크가 있어도 휴지통으로 보낼 수 있다", () => {
		const result = validate([trash("a/dup.md", "a/keep.md")], {
			files: ["a/dup.md", "a/keep.md", "a/n.md"],
			refs: [link("a/n.md", "dup", "a/dup.md")],
		});
		expect(result.rejected).toEqual([]);
		expect(result.accepted).toHaveLength(1);
	});

	test("링크가 없는 파일은 휴지통으로 보낼 수 있다", () => {
		const result = validate([trash("a/x.md")], { files: ["a/x.md"] });
		expect(result.accepted).toHaveLength(1);
	});

	test("비어 있지 않은 폴더는 지울 수 없다", () => {
		const result = validate([removeFolder("a/sub")], {
			files: ["a/sub/deep/x.md"],
		});
		expect(result.rejected).toEqual([
			{ opId: "removeEmptyFolder:a/sub", reason: "폴더가 비어 있지 않음" },
		]);
	});

	test("최상위 폴더는 비어 있어도 지울 수 없다", () => {
		const result = validate([removeFolder("빈최상위")], {
			emptyFolders: ["빈최상위"],
		});
		expect(result.rejected).toEqual([
			{
				opId: "removeEmptyFolder:빈최상위",
				reason: "최상위 폴더는 지울 수 없음",
			},
		]);
	});

	test("빈 하위 폴더는 지울 수 있다", () => {
		const result = validate([removeFolder("a/빈폴더")], {
			files: ["a/x.md"],
			emptyFolders: ["a/빈폴더"],
		});
		expect(result.accepted).toHaveLength(1);
	});

	test("통과한 연산은 입력 순서를 유지한다", () => {
		const ops = [move("a/1.md", "a/s/1.md"), move("a/2.md", "a/s/2.md")];
		const result = validate(ops, { files: ["a/1.md", "a/2.md"] });
		expect(result.accepted).toEqual(ops);
	});
});
