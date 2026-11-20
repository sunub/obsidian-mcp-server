import { savePlan } from "../../src/shared/vault-ops/planStore.js";
import { scanVault } from "../../src/shared/vault-ops/scan.js";
import type {
	ActionTier,
	ChangePlan,
	PlanOp,
} from "../../src/shared/vault-ops/types.js";

export const PLAN_ID = "20261120-000000-test01";
export const UNTITLED_NOTE = "스터디/5주차/무제 2.md";

function move(from: string, to: string, tier: ActionTier = "bulk"): PlanOp {
	return { id: `move:${from}`, type: "move", from, to, tier, reason: "test" };
}

function trash(path: string, redirectTo: string | null): PlanOp {
	return {
		id: `trash:${path}`,
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

export const FIXTURE_OPS: PlanOp[] = [
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

export async function savedFixturePlan(
	root: string,
	ops: PlanOp[] = FIXTURE_OPS,
): Promise<ChangePlan> {
	const snapshot = await scanVault(root);
	const plan: ChangePlan = {
		planId: PLAN_ID,
		createdAt: "2026-11-20T00:00:00.000Z",
		source: "tidy",
		scope: null,
		ops,
		needsTitle: [{ path: UNTITLED_NOTE, preview: "" }],
		fileHashes: Object.fromEntries(snapshot.files.map((f) => [f.path, f.hash])),
	};
	await savePlan(root, plan);
	return plan;
}

export async function vaultState(root: string): Promise<{
	hashes: Record<string, string>;
	emptyFolders: string[];
}> {
	const snapshot = await scanVault(root);
	return {
		hashes: Object.fromEntries(snapshot.files.map((f) => [f.path, f.hash])),
		emptyFolders: snapshot.emptyFolders,
	};
}

export function approveAll(ops: PlanOp[]): string[] {
	return ops.map((op) => op.id);
}
