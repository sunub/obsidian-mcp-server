import path from "node:path";
import {
	ATTACHMENT_EXTENSIONS,
	type FileKind,
	type LinkRef,
	type VaultFile,
	type VaultSnapshot,
} from "../../src/shared/vault-ops/types.js";

function kindOf(filePath: string): FileKind {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".md") return "note";
	return ATTACHMENT_EXTENSIONS.includes(ext) ? "attachment" : "other";
}

export function file(
	filePath: string,
	overrides: Partial<VaultFile> = {},
): VaultFile {
	return {
		path: filePath,
		kind: kindOf(filePath),
		size: 1,
		hash: `h:${filePath}`,
		mtimeMs: 0,
		...overrides,
	};
}

export function snapshotOf(
	files: VaultFile[],
	extra: { emptyFolders?: string[] } = {},
): VaultSnapshot {
	const folders = new Set<string>();
	for (const f of files) {
		const parts = f.path.split("/").slice(0, -1);
		for (let i = 1; i <= parts.length; i++) {
			folders.add(parts.slice(0, i).join("/"));
		}
	}
	return {
		root: "/vault",
		files,
		folders: [...folders],
		emptyFolders: extra.emptyFolders ?? [],
	};
}

export function link(
	from: string,
	target: string,
	resolved: string | null,
	overrides: Partial<LinkRef> = {},
): LinkRef {
	return {
		from,
		raw: `[[${target}]]`,
		start: 0,
		end: 0,
		target,
		form: "wiki",
		suffix: "",
		resolved,
		ambiguous: false,
		...overrides,
	};
}

export function notesReader(
	contents: Record<string, string>,
): (path: string) => Promise<string> {
	return async (notePath) => {
		const content = contents[notePath];
		if (content === undefined) throw new Error(`no such note: ${notePath}`);
		return content;
	};
}
