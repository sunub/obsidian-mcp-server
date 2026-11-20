import type { FileKind } from "./types.js";

export function topFolderOf(path: string): string | null {
	const index = path.indexOf("/");
	return index === -1 ? null : path.slice(0, index);
}

export function checkMoveBoundary(_input: {
	from: string;
	to: string;
	kind: FileKind;
	referencingNotes: string[];
}): string | null {
	throw new Error("not implemented");
}
