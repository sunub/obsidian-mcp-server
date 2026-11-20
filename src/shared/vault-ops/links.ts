import type {
	LinkForm,
	LinkGraph,
	ParsedLink,
	VaultSnapshot,
} from "./types.js";

export function parseLinks(_from: string, _content: string): ParsedLink[] {
	throw new Error("not implemented");
}

export function resolveTarget(
	_target: string,
	_form: LinkForm,
	_from: string,
	_paths: readonly string[],
): { resolved: string | null; ambiguous: boolean } {
	throw new Error("not implemented");
}

export async function buildLinkGraph(
	_snapshot: VaultSnapshot,
	_readNote: (path: string) => Promise<string>,
): Promise<LinkGraph> {
	throw new Error("not implemented");
}

export function linkTargetFor(
	_targetPath: string,
	_from: string,
	_form: LinkForm,
	_paths: readonly string[],
): string {
	throw new Error("not implemented");
}

export function rewriteLink(_link: ParsedLink, _newTarget: string): string {
	throw new Error("not implemented");
}
