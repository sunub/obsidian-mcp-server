import { stripJosa } from "./josa.js";

const INDEX_TOKEN = /[a-z0-9가-힣]+/g;
const EDGE_PUNCTUATION = /^[^a-z0-9가-힣]+|[^a-z0-9가-힣]+$/g;
const MIN_PART_LENGTH = 2;
const STEM_PREFIX = "~";
export const STEM_WEIGHT = 0.7;

export interface WeightedTerm {
	term: string;
	weight: number;
}

export interface TermCounts {
	length: number;
	counts: Map<string, number>;
}

export interface QueryUnit {
	alternatives: WeightedTerm[];
	partAlternatives: WeightedTerm[][];
}

function increment(counts: Map<string, number>, term: string): void {
	counts.set(term, (counts.get(term) ?? 0) + 1);
}

export function countTerms(
	text: string,
	extraAtoms: string[] = [],
): TermCounts {
	const tokens = text.toLowerCase().match(INDEX_TOKEN) ?? [];
	const counts = new Map<string, number>();
	for (const token of tokens) {
		increment(counts, token);
		const stem = stripJosa(token);
		if (stem !== token) increment(counts, STEM_PREFIX + stem);
	}
	for (const atom of extraAtoms) {
		if (atom) increment(counts, atom);
	}
	return { length: tokens.length + extraAtoms.length, counts };
}

function weightedAlternatives(token: string): WeightedTerm[] {
	const stem = stripJosa(token);
	const alternatives: WeightedTerm[] = [
		{ term: token, weight: 1 },
		{ term: STEM_PREFIX + token, weight: STEM_WEIGHT },
	];
	if (stem !== token) {
		alternatives.push(
			{ term: STEM_PREFIX + stem, weight: STEM_WEIGHT },
			{ term: stem, weight: STEM_WEIGHT },
		);
	}
	return alternatives;
}

function withoutDuplicates(alternatives: WeightedTerm[]): WeightedTerm[] {
	const seen = new Set<string>();
	return alternatives.filter(({ term }) => {
		if (term.length === 0 || seen.has(term)) return false;
		seen.add(term);
		return true;
	});
}

export function parseQuery(query: string): QueryUnit[] {
	return query
		.toLowerCase()
		.split(/\s+/)
		.filter((token) => token.length > 0)
		.map((token) => {
			const edgeStripped = token.replace(EDGE_PUNCTUATION, "");
			const parts = (token.match(INDEX_TOKEN) ?? []).filter(
				(part) => part.length >= MIN_PART_LENGTH,
			);
			return {
				alternatives: withoutDuplicates([
					{ term: token, weight: 1 },
					...(edgeStripped ? weightedAlternatives(edgeStripped) : []),
				]),
				partAlternatives:
					parts.length > 1 ? parts.map(weightedAlternatives) : [],
			};
		});
}
