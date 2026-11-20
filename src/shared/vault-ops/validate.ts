import { checkMoveBoundary, topFolderOf } from "./boundary.js";
import { pathKey } from "./ids.js";
import type {
	ChangePlan,
	LinkGraph,
	MoveOp,
	PlanOp,
	RemoveEmptyFolderOp,
	TrashOp,
	VaultFile,
	VaultSnapshot,
} from "./types.js";

type Rejection = { opId: string; reason: string };
type ValidationInput = {
	ops: PlanOp[];
	plan: ChangePlan;
	snapshot: VaultSnapshot;
	graph: LinkGraph;
};
type Context = Omit<ValidationInput, "ops"> & {
	filesByKey: Map<string, VaultFile>;
};

function referencingNotesOf(graph: LinkGraph, path: string): string[] {
	return [...new Set(graph.inbound(path).map((ref) => ref.from))];
}

function changedSincePlan(path: string, context: Context): boolean {
	const touched = [path, ...referencingNotesOf(context.graph, path)];
	return touched.some((candidate) => {
		const planned = context.plan.fileHashes[candidate];
		if (planned === undefined) return false;
		return context.filesByKey.get(pathKey(candidate))?.hash !== planned;
	});
}

function checkFileOp(path: string, context: Context): string | null {
	if (!context.filesByKey.has(pathKey(path))) return "원본 파일이 없음";
	if (changedSincePlan(path, context)) return "계획 이후 파일이 바뀜";
	return null;
}

function checkMove(op: MoveOp, context: Context): string | null {
	const sourceProblem = checkFileOp(op.from, context);
	if (sourceProblem) return sourceProblem;
	const source = context.filesByKey.get(pathKey(op.from));
	const boundary = checkMoveBoundary({
		from: op.from,
		to: op.to,
		kind: source?.kind ?? "other",
		referencingNotes: referencingNotesOf(context.graph, op.from),
	});
	if (boundary) return boundary;
	if (context.filesByKey.has(pathKey(op.to))) return "목적지에 파일이 있음";
	return null;
}

function checkTrash(op: TrashOp, context: Context): string | null {
	const sourceProblem = checkFileOp(op.path, context);
	if (sourceProblem) return sourceProblem;
	const hasLinks = context.graph.inbound(op.path).length > 0;
	if (hasLinks && op.redirectTo === null) {
		return "링크가 남아 있어 휴지통으로 보낼 수 없음";
	}
	return null;
}

function checkRemoveFolder(
	op: RemoveEmptyFolderOp,
	context: Context,
): string | null {
	if (topFolderOf(op.path) === null) return "최상위 폴더는 지울 수 없음";
	const prefix = `${pathKey(op.path)}/`;
	const hasFiles = [...context.filesByKey.keys()].some((key) =>
		key.startsWith(prefix),
	);
	return hasFiles ? "폴더가 비어 있지 않음" : null;
}

function checkOp(op: PlanOp, context: Context): string | null {
	switch (op.type) {
		case "move":
			return checkMove(op, context);
		case "trash":
			return checkTrash(op, context);
		case "removeEmptyFolder":
			return checkRemoveFolder(op, context);
		case "report":
			return null;
	}
}

function findDestinationCollisions(moves: MoveOp[]): Set<string> {
	const idsByDestination = new Map<string, string[]>();
	for (const op of moves) {
		const key = pathKey(op.to);
		idsByDestination.set(key, [...(idsByDestination.get(key) ?? []), op.id]);
	}
	const colliding = new Set<string>();
	for (const ids of idsByDestination.values()) {
		if (ids.length > 1) for (const id of ids) colliding.add(id);
	}
	return colliding;
}

export function validateOps(input: ValidationInput): {
	accepted: PlanOp[];
	rejected: Rejection[];
} {
	const context: Context = {
		plan: input.plan,
		snapshot: input.snapshot,
		graph: input.graph,
		filesByKey: new Map(input.snapshot.files.map((f) => [pathKey(f.path), f])),
	};
	const rejections = new Map<string, string>();
	const candidates = input.ops.filter((op) => op.type !== "report");
	for (const op of candidates) {
		const reason = checkOp(op, context);
		if (reason) rejections.set(op.id, reason);
	}
	const survivingMoves = candidates.filter(
		(op): op is MoveOp => op.type === "move" && !rejections.has(op.id),
	);
	for (const id of findDestinationCollisions(survivingMoves)) {
		rejections.set(id, "다른 연산과 목적지가 겹침");
	}
	return {
		accepted: candidates.filter((op) => !rejections.has(op.id)),
		rejected: candidates.flatMap((op) => {
			const reason = rejections.get(op.id);
			return reason ? [{ opId: op.id, reason }] : [];
		}),
	};
}
