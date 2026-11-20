import { posix } from "node:path";
import {
	makeOpId,
	type Planner,
	type PlanOp,
	pathKey,
	topFolderOf,
} from "@shared/vault-ops/index.js";

const LEGACY_ATTACHMENTS_FOLDER = "첨부파일";

function folderOf(path: string): string {
	const dir = posix.dirname(path);
	return dir === "." ? "" : dir;
}

function joinPath(folder: string, name: string): string {
	return folder === "" ? name : `${folder}/${name}`;
}

function report(path: string, reason: string): PlanOp {
	return {
		id: makeOpId("report", `attachments:${path}`),
		type: "report",
		paths: [path],
		tier: "report",
		reason,
	};
}

export const planAttachments: Planner = async ({
	snapshot,
	graph,
	options,
}) => {
	const folderName = options.attachmentsFolderName;
	const takenPaths = new Set(snapshot.files.map((f) => pathKey(f.path)));
	const claimedDestinations = new Set<string>();
	const ops: PlanOp[] = [];

	const attachments = snapshot.files
		.filter((f) => f.kind === "attachment")
		.map((f) => f.path)
		.sort();

	for (const path of attachments) {
		const notes = [
			...new Set(graph.inbound(path).map((ref) => ref.from)),
		].sort();
		if (notes.length === 0) {
			ops.push(report(path, "참조하는 노트가 없음"));
			continue;
		}
		if (new Set(notes.map((note) => topFolderOf(note))).size > 1) {
			ops.push(report(path, "서로 다른 최상위 폴더의 노트가 함께 사용"));
			continue;
		}

		const name = posix.basename(path);
		const parent = folderOf(path);
		const parentName = posix.basename(parent);
		const destinationFolder =
			parentName === LEGACY_ATTACHMENTS_FOLDER
				? joinPath(folderOf(parent), folderName)
				: joinPath(folderOf(notes[0]), folderName);
		const destination = joinPath(destinationFolder, name);

		if (destination === path || parentName === folderName) continue;

		const key = pathKey(destination);
		if (takenPaths.has(key) || claimedDestinations.has(key)) {
			ops.push(report(path, "목적지에 같은 이름의 파일이 있음"));
			continue;
		}
		claimedDestinations.add(key);
		ops.push({
			id: makeOpId("move", path),
			type: "move",
			from: path,
			to: destination,
			tier: "bulk",
			reason: `노트 옆 ${folderName} 폴더로 이동`,
		});
	}

	return { ops, needsTitle: [] };
};
