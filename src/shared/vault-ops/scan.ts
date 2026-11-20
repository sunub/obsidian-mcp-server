import type { FileKind, VaultSnapshot } from "./types.js";

export async function scanVault(_root: string): Promise<VaultSnapshot> {
	throw new Error("not implemented");
}

export function classifyFile(_path: string): FileKind {
	throw new Error("not implemented");
}
