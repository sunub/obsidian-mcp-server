import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
	ATTACHMENT_EXTENSIONS,
	EXCLUDED_DIRS,
	type FileKind,
	NOTE_EXTENSIONS,
	type VaultFile,
	type VaultSnapshot,
} from "./types.js";

export function classifyFile(filePath: string): FileKind {
	const ext = path.extname(filePath).toLowerCase();
	if (NOTE_EXTENSIONS.includes(ext)) return "note";
	if (ATTACHMENT_EXTENSIONS.includes(ext)) return "attachment";
	return "other";
}

function isSkippedName(name: string): boolean {
	return name.startsWith(".") || EXCLUDED_DIRS.includes(name);
}

async function readVaultFile(
	root: string,
	relativePath: string,
): Promise<VaultFile | null> {
	const absolute = path.join(root, relativePath);
	try {
		const [content, info] = await Promise.all([
			readFile(absolute),
			stat(absolute),
		]);
		return {
			path: relativePath,
			kind: classifyFile(relativePath),
			size: info.size,
			hash: createHash("sha256").update(content).digest("hex"),
			mtimeMs: info.mtimeMs,
		};
	} catch {
		return null;
	}
}

type Walk = {
	files: VaultFile[];
	folders: string[];
	emptyFolders: string[];
};

async function walk(
	root: string,
	relativeDir: string,
	out: Walk,
): Promise<number> {
	const entries = await readdir(path.join(root, relativeDir), {
		withFileTypes: true,
	}).catch(() => []);
	let fileCount = 0;
	for (const entry of entries) {
		if (isSkippedName(entry.name) || entry.isSymbolicLink()) continue;
		const relativePath = relativeDir
			? `${relativeDir}/${entry.name}`
			: entry.name;
		if (entry.isDirectory()) {
			out.folders.push(relativePath);
			const count = await walk(root, relativePath, out);
			if (count === 0) out.emptyFolders.push(relativePath);
			fileCount += count;
		} else if (entry.isFile()) {
			const file = await readVaultFile(root, relativePath);
			if (file) {
				out.files.push(file);
				fileCount += 1;
			}
		}
	}
	return fileCount;
}

function byPath(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export async function scanVault(root: string): Promise<VaultSnapshot> {
	const out: Walk = { files: [], folders: [], emptyFolders: [] };
	await walk(root, "", out);
	return {
		root,
		files: out.files.sort((a, b) => byPath(a.path, b.path)),
		folders: out.folders.sort(byPath),
		emptyFolders: out.emptyFolders.sort(byPath),
	};
}
