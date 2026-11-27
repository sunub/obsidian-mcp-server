import fs from "node:fs/promises";
import { posix } from "node:path";
import {
	absolute,
	createFolders,
	hashOfFile,
	isRemovableTree,
	pathExists,
	removeTree,
	sha256,
	uniqueTrashName,
} from "./fsOps.js";
import { makeOpId, newRunId, pathKey } from "./ids.js";
import { readJournal, writeJournal } from "./journal.js";
import { buildLinkGraph } from "./links.js";
import { loadPlan } from "./planStore.js";
import { computeRewrites } from "./rewritePlan.js";
import { scanVault } from "./scan.js";
import {
	type ApplyRequest,
	type ApplyResult,
	type ChangePlan,
	type JournalEntry,
	type MoveOp,
	type PlanOp,
	type RemoveEmptyFolderOp,
	type RunJournal,
	type TitleRename,
	TRASH_DIR,
	type TrashOp,
	type UndoResult,
	type VaultSnapshot,
} from "./types.js";
import { validateOps } from "./validate.js";

type Rejection = { opId: string; reason: string };
type Recorder = (entry: JournalEntry) => Promise<void>;
type ExecutionOutcome = {
	rewrittenLinks: number;
	removedFolders: string[];
	rejected: Rejection[];
};

const FORBIDDEN_TITLE_CHARS = /[\\/:*?"<>|#^[\]]/g;
const CHANGED_AFTER_RUN = "실행 후 바뀜";

function sanitizeTitle(title: string): string {
	return title.replace(FORBIDDEN_TITLE_CHARS, "").trim();
}

function renameOps(
	plan: ChangePlan,
	renames: TitleRename[],
): { ops: MoveOp[]; rejected: Rejection[] } {
	const needsTitle = new Set(plan.needsTitle.map((n) => pathKey(n.path)));
	const latestByPath = new Map(renames.map((r) => [r.path, r]));
	const ops: MoveOp[] = [];
	const rejected: Rejection[] = [];
	for (const { path, title } of latestByPath.values()) {
		const id = makeOpId("rename", path);
		const cleaned = sanitizeTitle(title);
		if (!needsTitle.has(pathKey(path))) {
			rejected.push({ opId: id, reason: "이름 변경 대상이 아님" });
		} else if (cleaned === "") {
			rejected.push({ opId: id, reason: "제목이 비어 있음" });
		} else {
			const folder = posix.dirname(path);
			const fileName = `${cleaned}.md`;
			ops.push({
				id,
				type: "move",
				from: path,
				to: folder === "." ? fileName : `${folder}/${fileName}`,
				tier: "per_item",
				reason: "무제 노트 이름 변경",
			});
		}
	}
	return { ops, rejected };
}

function unrunnableApprovals(
	plan: ChangePlan,
	approved: Set<string>,
	renames: { ops: MoveOp[]; rejected: Rejection[] },
): Rejection[] {
	const typeById = new Map(plan.ops.map((op) => [op.id, op.type]));
	const renameIds = new Set([
		...renames.ops.map((op) => op.id),
		...renames.rejected.map((r) => r.opId),
	]);
	return [...approved].flatMap((opId) => {
		if (renameIds.has(opId)) return [];
		const type = typeById.get(opId);
		if (type === undefined) return [{ opId, reason: "계획에 없는 연산" }];
		if (type === "report") {
			return [{ opId, reason: "보고 전용 항목은 실행할 수 없음" }];
		}
		return [];
	});
}

function canonicalizer(snapshot: VaultSnapshot): (op: PlanOp) => PlanOp {
	const files = new Map(snapshot.files.map((f) => [pathKey(f.path), f.path]));
	const folders = new Map(snapshot.folders.map((f) => [pathKey(f), f]));
	return (op) => {
		switch (op.type) {
			case "move":
				return { ...op, from: files.get(pathKey(op.from)) ?? op.from };
			case "trash":
				return { ...op, path: files.get(pathKey(op.path)) ?? op.path };
			case "removeEmptyFolder":
				return { ...op, path: folders.get(pathKey(op.path)) ?? op.path };
			case "report":
				return op;
		}
	};
}

function ancestorFolders(filePath: string): string[] {
	const folders: string[] = [];
	for (
		let folder = posix.dirname(filePath);
		folder.includes("/");
		folder = posix.dirname(folder)
	) {
		folders.push(folder);
	}
	return folders;
}

function depthOf(folder: string): number {
	return folder.split("/").length;
}

async function moveFiles(
	root: string,
	moves: MoveOp[],
	hashes: Map<string, string>,
	record: Recorder,
): Promise<void> {
	for (const op of moves) {
		await createFolders(root, posix.dirname(op.to), (path) =>
			record({ kind: "createFolder", path }),
		);
	}
	for (const op of moves) {
		await record({
			kind: "move",
			from: op.from,
			to: op.to,
			hash: hashes.get(op.from) ?? "",
		});
		await fs.rename(absolute(root, op.from), absolute(root, op.to));
	}
}

async function trashFiles(
	root: string,
	trashes: TrashOp[],
	hashes: Map<string, string>,
	record: Recorder,
): Promise<void> {
	if (trashes.length === 0) return;
	const trashDir = absolute(root, TRASH_DIR);
	await fs.mkdir(trashDir, { recursive: true });
	for (const op of trashes) {
		const name = await uniqueTrashName(trashDir, posix.basename(op.path));
		const to = `${TRASH_DIR}/${name}`;
		await record({
			kind: "trash",
			from: op.path,
			to,
			hash: hashes.get(op.path) ?? "",
		});
		await fs.rename(absolute(root, op.path), absolute(root, to));
	}
}

async function removeFolders(
	root: string,
	candidates: string[],
	approvedIds: Map<string, string>,
	record: Recorder,
): Promise<{ removed: string[]; rejected: Rejection[] }> {
	const removed: string[] = [];
	const rejected: Rejection[] = [];
	const ordered = [...new Set(candidates)].sort(
		(a, b) => depthOf(b) - depthOf(a),
	);
	for (const folder of ordered) {
		if (!(await pathExists(absolute(root, folder)))) continue;
		if (await isRemovableTree(absolute(root, folder))) {
			await removeTree(root, folder, async (path) => {
				removed.push(path);
				await record({ kind: "removeFolder", path });
			});
			continue;
		}
		const opId = approvedIds.get(folder);
		if (opId) rejected.push({ opId, reason: "폴더가 비어 있지 않음" });
	}
	return { removed, rejected };
}

async function execute(
	root: string,
	accepted: PlanOp[],
	snapshot: VaultSnapshot,
	record: Recorder,
): Promise<ExecutionOutcome> {
	const readNote = (path: string) => fs.readFile(absolute(root, path), "utf-8");
	const graph = await buildLinkGraph(snapshot, readNote);
	const moveOps = accepted.filter((op): op is MoveOp => op.type === "move");
	const trashOps = accepted.filter((op): op is TrashOp => op.type === "trash");
	const folderOps = accepted.filter(
		(op): op is RemoveEmptyFolderOp => op.type === "removeEmptyFolder",
	);
	const moves = new Map(moveOps.map((op) => [op.from, op.to]));
	const trashed = new Map(trashOps.map((op) => [op.path, op.redirectTo]));
	const hashes = new Map(snapshot.files.map((f) => [f.path, f.hash]));
	const pathsAfter = snapshot.files
		.map((f) => f.path)
		.filter((p) => !trashed.has(p))
		.map((p) => moves.get(p) ?? p);
	const rewrites = await computeRewrites({
		graph,
		moves,
		trashed,
		pathsAfter,
		readNote,
	});

	await moveFiles(root, moveOps, hashes, record);
	await trashFiles(root, trashOps, hashes, record);
	for (const rewrite of rewrites) {
		await record({
			kind: "rewrite",
			path: rewrite.notePathAfter,
			before: rewrite.before,
			afterHash: sha256(Buffer.from(rewrite.after, "utf-8")),
		});
		await fs.writeFile(
			absolute(root, rewrite.notePathAfter),
			rewrite.after,
			"utf-8",
		);
	}

	const emptiedByRun = [...moves.keys(), ...trashed.keys()].flatMap(
		ancestorFolders,
	);
	const folders = await removeFolders(
		root,
		[...folderOps.map((op) => op.path), ...emptiedByRun],
		new Map(folderOps.map((op) => [op.path, op.id])),
		record,
	);
	return {
		rewrittenLinks: rewrites.reduce((sum, r) => sum + r.count, 0),
		removedFolders: folders.removed,
		rejected: folders.rejected,
	};
}

async function startRun(root: string, planId: string) {
	const journal: RunJournal = {
		runId: newRunId(),
		planId,
		createdAt: new Date().toISOString(),
		undoneAt: null,
		entries: [],
	};
	await writeJournal(root, journal);
	const record: Recorder = async (entry) => {
		journal.entries.push(entry);
		await writeJournal(root, journal);
	};
	return { runId: journal.runId, record };
}

export async function applyPlan(
	root: string,
	request: ApplyRequest,
): Promise<ApplyResult> {
	const plan = await loadPlan(root, request.planId);
	if (!plan) throw new Error(`계획을 찾을 수 없음: ${request.planId}`);
	const approved = new Set(request.approvedOpIds);
	const renames = renameOps(plan, request.renames);
	const snapshot = await scanVault(root);
	const graph = await buildLinkGraph(snapshot, (path) =>
		fs.readFile(absolute(root, path), "utf-8"),
	);
	const canonical = canonicalizer(snapshot);
	const candidates = [
		...plan.ops.filter((op) => op.type !== "report" && approved.has(op.id)),
		...renames.ops,
	].map(canonical);
	const validation = validateOps({ ops: candidates, plan, snapshot, graph });

	const run = await startRun(root, plan.planId);
	let outcome: ExecutionOutcome;
	try {
		outcome = await execute(root, validation.accepted, snapshot, run.record);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`실행 중 오류: ${reason} (runId: ${run.runId})`, {
			cause: error,
		});
	}
	const rejected = [
		...unrunnableApprovals(plan, approved, renames),
		...renames.rejected,
		...validation.rejected,
		...outcome.rejected,
	];
	const rejectedIds = new Set(rejected.map((r) => r.opId));
	return {
		runId: run.runId,
		applied: validation.accepted
			.map((op) => op.id)
			.filter((id) => !rejectedIds.has(id)),
		rejected,
		rewrittenLinks: outcome.rewrittenLinks,
		removedFolders: outcome.removedFolders,
	};
}

type UndoContext = { root: string; conflicts: UndoResult["conflicts"] };

async function undoEntry(
	entry: JournalEntry,
	context: UndoContext,
): Promise<boolean> {
	const { root, conflicts } = context;
	const conflict = (path: string) => {
		conflicts.push({ path, reason: CHANGED_AFTER_RUN });
		return false;
	};
	switch (entry.kind) {
		case "rewrite": {
			const hash = await hashOfFile(absolute(root, entry.path));
			if (hash === sha256(entry.before)) return false;
			if (hash !== entry.afterHash) return conflict(entry.path);
			await fs.writeFile(absolute(root, entry.path), entry.before, "utf-8");
			return true;
		}
		case "move":
		case "trash": {
			const fromHash = await hashOfFile(absolute(root, entry.from));
			const toExists = await pathExists(absolute(root, entry.to));
			if (!toExists && fromHash === entry.hash) return false;
			const hash = await hashOfFile(absolute(root, entry.to));
			const fromIsFree = !(await pathExists(absolute(root, entry.from)));
			if (hash !== entry.hash || !fromIsFree) return conflict(entry.to);
			await fs.mkdir(absolute(root, posix.dirname(entry.from)), {
				recursive: true,
			});
			await fs.rename(absolute(root, entry.to), absolute(root, entry.from));
			return true;
		}
		case "createFolder": {
			const target = absolute(root, entry.path);
			const children = await fs.readdir(target).catch(() => null);
			if (children === null) return false;
			if (children.length > 0) return conflict(entry.path);
			await fs.rmdir(target);
			return true;
		}
		case "removeFolder":
			if (await pathExists(absolute(root, entry.path))) return false;
			await fs.mkdir(absolute(root, entry.path), { recursive: true });
			return true;
	}
}

export async function undoRun(
	root: string,
	runId: string,
): Promise<UndoResult> {
	const journal = await readJournal(root, runId);
	if (!journal) throw new Error(`실행 기록을 찾을 수 없음: ${runId}`);
	if (journal.undoneAt) throw new Error(`이미 되돌린 실행: ${runId}`);
	const context: UndoContext = { root, conflicts: [] };
	let restored = 0;
	for (const entry of [...journal.entries].reverse()) {
		if (await undoEntry(entry, context)) restored += 1;
	}
	await writeJournal(root, {
		...journal,
		undoneAt: new Date().toISOString(),
	});
	return { runId, restored, conflicts: context.conflicts };
}
