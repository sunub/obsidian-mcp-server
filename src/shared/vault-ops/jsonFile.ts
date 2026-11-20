import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { VAULT_TIDY_DIR } from "./types.js";

export function isSafeId(id: string): boolean {
	return id.length > 0 && !/[/\\]/.test(id) && !id.includes("..");
}

export function storePath(root: string, folder: string, id: string): string {
	return path.join(root, VAULT_TIDY_DIR, folder, `${id}.json`);
}

export async function writeJsonAtomic(
	filePath: string,
	data: unknown,
): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const tmpPath = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
	await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
	await fs.rename(tmpPath, filePath);
}

export async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
	} catch {
		return null;
	}
}
