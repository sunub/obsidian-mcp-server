import fs from "node:fs/promises";
import path from "node:path";
import {
	buildLinkGraph,
	type ChangePlan,
	type LinkGraph,
	type NeedsTitle,
	newPlanId,
	type Planner,
	type PlanOp,
	pathKey,
	savePlan,
	scanVault,
	type TidyOptions,
	topFolderOf,
	type VaultSnapshot,
} from "@shared/vault-ops/index.js";
import { planAttachments } from "./planners/attachments.js";
import { planDuplicates } from "./planners/duplicates.js";
import { planEmptyFolders } from "./planners/empty-folders.js";
import { planUntitled } from "./planners/untitled.js";
import { buildPreview, type TidyPreview } from "./preview.js";

export const PLANNER_NAMES = [
	"duplicates",
	"untitled",
	"attachments",
	"emptyFolders",
] as const;

export type PlannerName = (typeof PLANNER_NAMES)[number];

const PLANNERS: Record<PlannerName, Planner> = {
	duplicates: planDuplicates,
	untitled: planUntitled,
	attachments: planAttachments,
	emptyFolders: planEmptyFolders,
};

export class TidyInputError extends Error {}

export function assertPlainFolderName(label: string, value: string): void {
	if (value.trim() === "" || /[/\\]/.test(value) || value.includes("..")) {
		throw new TidyInputError(`${label} 값이 올바르지 않음: ${value}`);
	}
}

function resolveScope(
	scope: string | null,
	snapshot: VaultSnapshot,
): string | null {
	if (scope === null) return null;
	assertPlainFolderName("scope", scope);
	const topFolders = snapshot.folders.filter((f) => topFolderOf(f) === null);
	const match = topFolders.find((f) => pathKey(f) === pathKey(scope));
	if (!match) {
		throw new TidyInputError(
			`scope에 해당하는 최상위 폴더가 없음: ${scope} (있는 폴더: ${topFolders.join(", ")})`,
		);
	}
	return match;
}

function touchedPaths(op: PlanOp): string[] {
	switch (op.type) {
		case "move":
			return [op.from, op.to];
		case "trash":
		case "removeEmptyFolder":
			return [op.path];
		case "report":
			return [];
	}
}

function scopePaths(op: PlanOp): string[] {
	return op.type === "report" ? op.paths : touchedPaths(op);
}

function isInScope(filePath: string, scope: string): boolean {
	return pathKey(topFolderOf(filePath) ?? filePath) === pathKey(scope);
}

function dropClaimedOps(ops: PlanOp[], claimed: Set<string>): PlanOp[] {
	const kept = ops.filter((op) =>
		touchedPaths(op).every((p) => !claimed.has(pathKey(p))),
	);
	for (const op of kept) {
		for (const p of touchedPaths(op)) claimed.add(pathKey(p));
	}
	return kept;
}

async function runPlanners(
	names: readonly PlannerName[],
	context: Parameters<Planner>[0],
): Promise<{ ops: PlanOp[]; needsTitle: NeedsTitle[] }> {
	const claimed = new Set<string>();
	const ops: PlanOp[] = [];
	const needsTitle: NeedsTitle[] = [];
	for (const name of PLANNER_NAMES.filter((n) => names.includes(n))) {
		const output = await PLANNERS[name](context);
		ops.push(...dropClaimedOps(output.ops, claimed));
		needsTitle.push(...output.needsTitle);
	}
	return { ops, needsTitle };
}

function existingFilesTouched(ops: PlanOp[]): string[] {
	return ops.flatMap((op) => {
		if (op.type === "move") return [op.from];
		if (op.type === "trash") return [op.path];
		return [];
	});
}

function collectFileHashes(
	ops: PlanOp[],
	snapshot: VaultSnapshot,
	graph: LinkGraph,
): Record<string, string> {
	const hashes = new Map(snapshot.files.map((f) => [f.path, f.hash]));
	const result: Record<string, string> = {};
	for (const file of existingFilesTouched(ops)) {
		for (const related of [file, ...graph.inbound(file).map((r) => r.from)]) {
			const hash = hashes.get(related);
			if (hash !== undefined) result[related] = hash;
		}
	}
	return result;
}

function countAffectedLinks(ops: PlanOp[], graph: LinkGraph): number {
	return existingFilesTouched(ops).reduce(
		(sum, file) => sum + graph.inbound(file).length,
		0,
	);
}

export async function buildTidyPlan(
	root: string,
	options: TidyOptions,
	planners: readonly PlannerName[] = PLANNER_NAMES,
): Promise<{ plan: ChangePlan; preview: TidyPreview }> {
	assertPlainFolderName("attachmentsFolderName", options.attachmentsFolderName);
	const snapshot = await scanVault(root);
	const scope = resolveScope(options.scope, snapshot);
	const readNote = (notePath: string) =>
		fs.readFile(path.join(root, notePath), "utf-8");
	const graph = await buildLinkGraph(snapshot, readNote);
	const output = await runPlanners(planners, {
		snapshot,
		graph,
		options: { ...options, scope },
		readNote,
	});

	const inScope = (paths: string[]) =>
		scope === null || paths.every((p) => isInScope(p, scope));
	const ops = output.ops.filter((op) => inScope(scopePaths(op)));
	const needsTitle = output.needsTitle.filter((n) => inScope([n.path]));

	const plan: ChangePlan = {
		planId: newPlanId(),
		createdAt: new Date().toISOString(),
		source: "tidy",
		scope,
		ops,
		needsTitle,
		fileHashes: collectFileHashes(ops, snapshot, graph),
	};
	await savePlan(root, plan);
	return { plan, preview: buildPreview(plan, countAffectedLinks(ops, graph)) };
}
