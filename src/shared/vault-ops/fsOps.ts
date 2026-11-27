import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const PLACEHOLDER_FILES: readonly string[] = [".gitkeep", ".DS_Store"];

export function sha256(content: Buffer | string): string {
	return createHash("sha256").update(content).digest("hex");
}

export function absolute(root: string, relative: string): string {
	return path.join(root, relative);
}

export async function pathExists(target: string): Promise<boolean> {
	return fs
		.access(target)
		.then(() => true)
		.catch(() => false);
}

export async function hashOfFile(target: string): Promise<string | null> {
	return fs
		.readFile(target)
		.then(sha256)
		.catch(() => null);
}

export async function createFolders(
	root: string,
	relativeFolder: string,
	beforeCreate: (path: string) => Promise<void>,
): Promise<void> {
	if (relativeFolder === "" || relativeFolder === ".") return;
	const segments = relativeFolder.split("/");
	for (let depth = 1; depth <= segments.length; depth++) {
		const prefix = segments.slice(0, depth).join("/");
		if (await pathExists(absolute(root, prefix))) continue;
		await beforeCreate(prefix);
		await fs.mkdir(absolute(root, prefix));
	}
}

export async function isRemovableTree(target: string): Promise<boolean> {
	const entries = await fs
		.readdir(target, { withFileTypes: true })
		.catch(() => null);
	if (entries === null) return false;
	for (const entry of entries) {
		const child = path.join(target, entry.name);
		if (entry.isDirectory()) {
			if (!(await isRemovableTree(child))) return false;
		} else if (!entry.isFile() || !PLACEHOLDER_FILES.includes(entry.name)) {
			return false;
		}
	}
	return true;
}

export async function removeTree(
	root: string,
	relativeFolder: string,
	beforeRemove: (path: string) => Promise<void>,
): Promise<void> {
	const target = absolute(root, relativeFolder);
	const entries = await fs.readdir(target, { withFileTypes: true });
	for (const entry of entries) {
		const child = `${relativeFolder}/${entry.name}`;
		if (entry.isDirectory()) await removeTree(root, child, beforeRemove);
		else await fs.unlink(absolute(root, child));
	}
	await beforeRemove(relativeFolder);
	await fs.rmdir(target);
}

export async function uniqueTrashName(
	trashDir: string,
	fileName: string,
): Promise<string> {
	const extension = path.extname(fileName);
	const stem = path.basename(fileName, extension);
	let candidate = fileName;
	for (
		let suffix = 1;
		await pathExists(path.join(trashDir, candidate));
		suffix++
	) {
		candidate = `${stem} ${suffix}${extension}`;
	}
	return candidate;
}
