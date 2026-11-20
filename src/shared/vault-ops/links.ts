import { posix } from "node:path";
import { createLinkGraph } from "./graph.js";
import { pathKey } from "./ids.js";
import {
	ATTACHMENT_EXTENSIONS,
	type LinkForm,
	type LinkGraph,
	type LinkRef,
	NOTE_EXTENSIONS,
	type ParsedLink,
	type VaultSnapshot,
} from "./types.js";

type Range = { start: number; end: number };

const LINKABLE_EXTENSIONS: readonly string[] = [
	...NOTE_EXTENSIONS,
	...ATTACHMENT_EXTENSIONS,
	".canvas",
	".base",
];
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
const WIKI_LINK = /(!?)\[\[([^\]\n]*)\]\]/g;
const MARKDOWN_LINK = /(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g;

function fencedRanges(content: string): Range[] {
	const ranges: Range[] = [];
	let open: { marker: string; start: number } | null = null;
	let offset = 0;
	for (const line of content.split("\n")) {
		const lineEnd = offset + line.length;
		const fence = FENCE.exec(line)?.[1];
		if (open === null) {
			if (fence) open = { marker: fence, start: offset };
		} else if (
			fence &&
			fence[0] === open.marker[0] &&
			fence.length >= open.marker.length
		) {
			ranges.push({ start: open.start, end: lineEnd });
			open = null;
		}
		offset = lineEnd + 1;
	}
	if (open) ranges.push({ start: open.start, end: content.length });
	return ranges;
}

function excludedRanges(content: string): Range[] {
	const fenced = fencedRanges(content);
	const inline: Range[] = [];
	for (const match of content.matchAll(INLINE_CODE)) {
		const start = match.index ?? 0;
		if (!isInside(start, fenced)) {
			inline.push({ start, end: start + match[0].length });
		}
	}
	return [...fenced, ...inline];
}

function isInside(position: number, ranges: readonly Range[]): boolean {
	return ranges.some((r) => position >= r.start && position < r.end);
}

function splitAt(text: string, pattern: RegExp): [string, string] {
	const index = text.search(pattern);
	return index === -1 ? [text, ""] : [text.slice(0, index), text.slice(index)];
}

function parseWikiLinks(from: string, content: string): ParsedLink[] {
	const links: ParsedLink[] = [];
	for (const match of content.matchAll(WIKI_LINK)) {
		const [target, suffix] = splitAt(match[2] ?? "", /[#^|]/);
		if (target === "") continue;
		const start = match.index ?? 0;
		links.push({
			from,
			raw: match[0],
			start,
			end: start + match[0].length,
			target,
			form: match[1] ? "embed" : "wiki",
			suffix,
		});
	}
	return links;
}

function parseMarkdownLinks(from: string, content: string): ParsedLink[] {
	const links: ParsedLink[] = [];
	for (const match of content.matchAll(MARKDOWN_LINK)) {
		const [target, suffix] = splitAt(match[3] ?? "", /#/);
		if (target === "" || SCHEME.test(target)) continue;
		const start = match.index ?? 0;
		links.push({
			from,
			raw: match[0],
			start,
			end: start + match[0].length,
			target,
			form: match[1] ? "markdown-embed" : "markdown",
			suffix,
		});
	}
	return links;
}

export function parseLinks(from: string, content: string): ParsedLink[] {
	const excluded = excludedRanges(content);
	return [
		...parseWikiLinks(from, content),
		...parseMarkdownLinks(from, content),
	]
		.filter((link) => !isInside(link.start, excluded))
		.sort((a, b) => a.start - b.start);
}

function withExtension(target: string): string {
	const ext = posix.extname(target).toLowerCase();
	return LINKABLE_EXTENSIONS.includes(ext) ? target : `${target}.md`;
}

function decodeOrRaw(target: string): string {
	try {
		return decodeURIComponent(target);
	} catch {
		return target;
	}
}

function findExact(candidate: string, paths: readonly string[]): string | null {
	const key = pathKey(candidate);
	return paths.find((p) => pathKey(p) === key) ?? null;
}

function candidatesFor(target: string, paths: readonly string[]): string[] {
	const key = pathKey(target);
	if (target.includes("/")) {
		return paths.filter((p) => {
			const pk = pathKey(p);
			return pk === key || pk.endsWith(`/${key}`);
		});
	}
	return paths.filter((p) => pathKey(posix.basename(p)) === key);
}

function pickCandidate(
	candidates: string[],
	from: string,
): { resolved: string | null; ambiguous: boolean } {
	if (candidates.length === 0) return { resolved: null, ambiguous: false };
	if (candidates.length === 1) {
		return { resolved: candidates[0] ?? null, ambiguous: false };
	}
	const fromDir = pathKey(posix.dirname(from));
	const sameFolder = candidates.find(
		(p) => pathKey(posix.dirname(p)) === fromDir,
	);
	if (sameFolder) return { resolved: sameFolder, ambiguous: false };
	const [shortest] = [...candidates].sort(
		(a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0),
	);
	return { resolved: shortest ?? null, ambiguous: true };
}

export function resolveTarget(
	target: string,
	form: LinkForm,
	from: string,
	paths: readonly string[],
): { resolved: string | null; ambiguous: boolean } {
	const isMarkdown = form === "markdown" || form === "markdown-embed";
	const name = withExtension(isMarkdown ? decodeOrRaw(target) : target);
	if (isMarkdown) {
		const relative = findExact(posix.join(posix.dirname(from), name), paths);
		if (relative) return { resolved: relative, ambiguous: false };
		const rooted = findExact(name.replace(/^\//, ""), paths);
		if (rooted) return { resolved: rooted, ambiguous: false };
	}
	return pickCandidate(candidatesFor(name, paths), from);
}

export async function buildLinkGraph(
	snapshot: VaultSnapshot,
	readNote: (path: string) => Promise<string>,
): Promise<LinkGraph> {
	const paths = snapshot.files.map((f) => f.path);
	const refs: LinkRef[] = [];
	for (const file of snapshot.files) {
		if (file.kind !== "note") continue;
		const content = await readNote(file.path);
		for (const link of parseLinks(file.path, content)) {
			refs.push({
				...link,
				...resolveTarget(link.target, link.form, file.path, paths),
			});
		}
	}
	return createLinkGraph(refs);
}

function stripNoteExtension(filePath: string): string {
	const ext = posix.extname(filePath).toLowerCase();
	return NOTE_EXTENSIONS.includes(ext)
		? filePath.slice(0, -ext.length)
		: filePath;
}

export function linkTargetFor(
	targetPath: string,
	from: string,
	form: LinkForm,
	paths: readonly string[],
): string {
	if (form === "markdown" || form === "markdown-embed") {
		return posix
			.relative(posix.dirname(from), targetPath)
			.replaceAll(" ", "%20");
	}
	const byName = stripNoteExtension(posix.basename(targetPath));
	const { resolved, ambiguous } = resolveTarget(byName, form, from, paths);
	if (
		!ambiguous &&
		resolved !== null &&
		pathKey(resolved) === pathKey(targetPath)
	) {
		return byName;
	}
	return stripNoteExtension(targetPath);
}

export function rewriteLink(link: ParsedLink, newTarget: string): string {
	const body = `${newTarget}${link.suffix}`;
	switch (link.form) {
		case "wiki":
			return `[[${body}]]`;
		case "embed":
			return `![[${body}]]`;
		case "markdown":
		case "markdown-embed": {
			const label = link.raw.slice(0, link.raw.lastIndexOf("]("));
			return `${label}](${body})`;
		}
	}
}
