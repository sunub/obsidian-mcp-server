import { EXCLUDED_DIRS, type FileKind } from "./types.js";

const CROSS_FOLDER_REASON = "최상위 폴더 경계를 넘는 이동";

export function topFolderOf(path: string): string | null {
	const index = path.indexOf("/");
	return index === -1 ? null : path.slice(0, index);
}

function escapesVault(path: string): boolean {
	return path.split("/").includes("..");
}

function isExcluded(path: string): boolean {
	const top = topFolderOf(path);
	return top !== null && EXCLUDED_DIRS.includes(top);
}

function followsReferencingNotes(
	to: string,
	referencingNotes: readonly string[],
): boolean {
	const destination = topFolderOf(to);
	return (
		referencingNotes.length > 0 &&
		referencingNotes.every((note) => topFolderOf(note) === destination)
	);
}

export function checkMoveBoundary(input: {
	from: string;
	to: string;
	kind: FileKind;
	referencingNotes: string[];
}): string | null {
	const { from, to, kind, referencingNotes } = input;
	if (escapesVault(to) || isExcluded(to)) return CROSS_FOLDER_REASON;
	const source = topFolderOf(from);
	if (source === null) return null;
	if (topFolderOf(to) === source) return null;
	if (kind === "attachment" && followsReferencingNotes(to, referencingNotes)) {
		return null;
	}
	return CROSS_FOLDER_REASON;
}
