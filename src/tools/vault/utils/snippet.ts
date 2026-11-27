import { stripJosa } from "@shared/indexing/keyword-search/josa.js";

export const SNIPPET_MAX_CHARS = 200;

const ELLIPSIS = "...";
const LEAD_CHARS = 60;
const WINDOW_CHARS = SNIPPET_MAX_CHARS - ELLIPSIS.length * 2;
const MIN_TERM_LENGTH = 2;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const flatten = (text: string) =>
	text.normalize("NFC").replace(/\s+/g, " ").trim();

function searchTerms(query: string): string[] {
	return flatten(query)
		.toLowerCase()
		.split(" ")
		.map((word) => word.replace(EDGE_PUNCTUATION, ""))
		.flatMap((word) => [word, stripJosa(word)])
		.filter((term) => term.length >= MIN_TERM_LENGTH);
}

function positionOf(text: string, terms: string[]): number {
	const haystack = text.toLowerCase();
	const found = terms.find((term) => haystack.includes(term));
	return found === undefined ? -1 : haystack.indexOf(found);
}

function windowAround(text: string, position: number): string {
	if (text.length <= SNIPPET_MAX_CHARS) return text;
	const start = Math.max(
		0,
		Math.min(position - LEAD_CHARS, text.length - WINDOW_CHARS),
	);
	const end = start + WINDOW_CHARS;
	const head = start > 0 ? ELLIPSIS : "";
	const tail = end < text.length ? ELLIPSIS : "";
	return `${head}${text.slice(start, end)}${tail}`;
}

export function createSnippet(
	query: string,
	sources: string[],
): string | undefined {
	const terms = searchTerms(query);
	const candidates = sources
		.map(flatten)
		.filter((text) => text.length > 0)
		.map((text) => ({ text, position: positionOf(text, terms) }));
	const best =
		candidates.find((candidate) => candidate.position !== -1) ?? candidates[0];
	return best && windowAround(best.text, Math.max(0, best.position));
}
