import { posix } from "node:path";
import {
	makeOpId,
	type NeedsTitle,
	type Planner,
	type PlanOp,
} from "@shared/vault-ops/index.js";
import matter from "gray-matter";

const UNTITLED_NAME = /^(무제|untitled)( \d+)?\.md$/i;
const PREVIEW_LENGTH = 300;

const CLOSED_FRONTMATTER = /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

function bodyOf(raw: string): string {
	if (raw.startsWith("---") && !CLOSED_FRONTMATTER.test(raw)) return raw;
	try {
		return matter(raw).content;
	} catch {
		return raw;
	}
}

function previewOf(body: string): string {
	return body.replace(/\s+/g, " ").trim().slice(0, PREVIEW_LENGTH);
}

export const planUntitled: Planner = async ({ snapshot, graph, readNote }) => {
	const ops: PlanOp[] = [];
	const needsTitle: NeedsTitle[] = [];

	const notes = snapshot.files
		.filter(
			(f) => f.kind === "note" && UNTITLED_NAME.test(posix.basename(f.path)),
		)
		.map((f) => f.path)
		.sort();

	for (const path of notes) {
		const body = bodyOf(await readNote(path));
		if (body.trim() !== "") {
			needsTitle.push({ path, preview: previewOf(body) });
		} else if (graph.inbound(path).length === 0) {
			ops.push({
				id: makeOpId("trash", path),
				type: "trash",
				path,
				redirectTo: null,
				tier: "per_item",
				reason: "비어 있는 무제 노트",
			});
		} else {
			ops.push({
				id: makeOpId("report", `untitled-linked:${path}`),
				type: "report",
				paths: [path],
				tier: "report",
				reason: "비어 있지만 다른 노트가 링크함",
			});
		}
	}

	return { ops, needsTitle };
};
