import { pathKey } from "./ids.js";
import { linkTargetFor, resolveTarget, rewriteLink } from "./links.js";
import type { LinkGraph, LinkRef } from "./types.js";

export type NoteRewrite = {
	notePathAfter: string;
	before: string;
	after: string;
	count: number;
};

type RewriteInput = {
	graph: LinkGraph;
	moves: Map<string, string>;
	trashed: Map<string, string | null>;
	pathsAfter: readonly string[];
	readNote: (path: string) => Promise<string>;
};

type Edit = { start: number; end: number; replacement: string };

function isMarkdownForm(ref: LinkRef): boolean {
	return ref.form === "markdown" || ref.form === "markdown-embed";
}

function intendedTarget(
	ref: LinkRef,
	moves: Map<string, string>,
	trashed: Map<string, string | null>,
): string | null {
	if (ref.resolved === null) return null;
	if (trashed.has(ref.resolved)) {
		const redirect = trashed.get(ref.resolved) ?? null;
		return redirect === null ? null : (moves.get(redirect) ?? redirect);
	}
	return moves.get(ref.resolved) ?? ref.resolved;
}

function needsRewrite(
	ref: LinkRef,
	intended: string,
	notePathAfter: string,
	input: RewriteInput,
): boolean {
	const current = resolveTarget(
		ref.target,
		ref.form,
		notePathAfter,
		input.pathsAfter,
	).resolved;
	if (current === null || pathKey(current) !== pathKey(intended)) return true;
	if (!isMarkdownForm(ref)) return false;
	const somethingMoved =
		notePathAfter !== ref.from || intended !== ref.resolved;
	if (!somethingMoved) return false;
	const literal = linkTargetFor(
		intended,
		notePathAfter,
		ref.form,
		input.pathsAfter,
	);
	return ref.target.normalize("NFC") !== literal.normalize("NFC");
}

function editsFor(
	refs: readonly LinkRef[],
	notePathAfter: string,
	input: RewriteInput,
): Edit[] {
	const edits: Edit[] = [];
	for (const ref of refs) {
		const intended = intendedTarget(ref, input.moves, input.trashed);
		if (intended === null) continue;
		if (!needsRewrite(ref, intended, notePathAfter, input)) continue;
		const target = linkTargetFor(
			intended,
			notePathAfter,
			ref.form,
			input.pathsAfter,
		);
		edits.push({
			start: ref.start,
			end: ref.end,
			replacement: rewriteLink(ref, target),
		});
	}
	return edits;
}

function applyEdits(content: string, edits: readonly Edit[]): string {
	return [...edits]
		.sort((a, b) => b.end - a.end)
		.reduce(
			(text, edit) =>
				text.slice(0, edit.start) + edit.replacement + text.slice(edit.end),
			content,
		);
}

function groupByNote(refs: readonly LinkRef[]): Map<string, LinkRef[]> {
	const groups = new Map<string, LinkRef[]>();
	for (const ref of refs) {
		const group = groups.get(ref.from);
		if (group) group.push(ref);
		else groups.set(ref.from, [ref]);
	}
	return groups;
}

export async function computeRewrites(
	input: RewriteInput,
): Promise<NoteRewrite[]> {
	const rewrites: NoteRewrite[] = [];
	for (const [note, refs] of groupByNote(input.graph.refs)) {
		if (input.trashed.has(note)) continue;
		const notePathAfter = input.moves.get(note) ?? note;
		const edits = editsFor(refs, notePathAfter, input);
		if (edits.length === 0) continue;
		const before = await input.readNote(note);
		rewrites.push({
			notePathAfter,
			before,
			after: applyEdits(before, edits),
			count: edits.length,
		});
	}
	return rewrites;
}
