import { posix } from "node:path";
import {
	makeOpId,
	type Planner,
	type PlannerContext,
	type PlanOp,
	pathKey,
	type VaultFile,
} from "@shared/vault-ops/index.js";

const UNTITLED_NAME = /^(무제|untitled)( \d+)?\.md$/i;

function compareStrings(a: string, b: string): number {
	if (a < b) return -1;
	return a > b ? 1 : 0;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const key = keyOf(item);
		const group = groups.get(key);
		if (group) group.push(item);
		else groups.set(key, [item]);
	}
	return groups;
}

async function nonEmptyCandidates({
	snapshot,
	readNote,
}: PlannerContext): Promise<VaultFile[]> {
	const candidates: VaultFile[] = [];
	for (const f of snapshot.files) {
		if (f.kind === "other" || f.size === 0) continue;
		if (f.kind === "note" && (await readNote(f.path)).trim() === "") continue;
		candidates.push(f);
	}
	return candidates;
}

function keepOrder(
	inboundCount: (path: string) => number,
): (a: VaultFile, b: VaultFile) => number {
	return (a, b) =>
		inboundCount(b.path) - inboundCount(a.path) ||
		b.path.split("/").length - a.path.split("/").length ||
		b.mtimeMs - a.mtimeMs ||
		compareStrings(a.path, b.path);
}

function planTrashes(
	candidates: VaultFile[],
	{ graph }: PlannerContext,
): PlanOp[] {
	const ops: PlanOp[] = [];
	const order = keepOrder((path) => graph.inbound(path).length);
	for (const group of groupBy(candidates, (f) => f.hash).values()) {
		if (group.length < 2) continue;
		const [kept, ...rest] = [...group].sort(order);
		for (const f of rest) {
			ops.push({
				id: makeOpId("trash", f.path),
				type: "trash",
				path: f.path,
				redirectTo: kept.path,
				tier: "per_item",
				reason: `내용이 같은 파일이 ${kept.path}에 있음`,
			});
		}
	}
	return ops.sort((a, b) =>
		compareStrings(
			a.type === "trash" ? a.path : "",
			b.type === "trash" ? b.path : "",
		),
	);
}

function planSameNameReports(candidates: VaultFile[]): PlanOp[] {
	const notes = candidates.filter(
		(f) => f.kind === "note" && !UNTITLED_NAME.test(posix.basename(f.path)),
	);
	const reports: PlanOp[] = [];
	const groups = groupBy(notes, (f) => pathKey(posix.basename(f.path)));
	for (const [name, group] of [...groups].sort(([a], [b]) =>
		compareStrings(a, b),
	)) {
		if (new Set(group.map((f) => f.hash)).size < 2) continue;
		reports.push({
			id: makeOpId("report", `same-name:${name}`),
			type: "report",
			paths: group.map((f) => f.path).sort(compareStrings),
			tier: "report",
			reason: "이름은 같고 내용이 다른 노트",
		});
	}
	return reports;
}

export const planDuplicates: Planner = async (ctx) => {
	const candidates = await nonEmptyCandidates(ctx);
	return {
		ops: [...planTrashes(candidates, ctx), ...planSameNameReports(candidates)],
		needsTitle: [],
	};
};
