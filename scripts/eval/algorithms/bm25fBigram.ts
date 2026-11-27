import { basename, extname } from "node:path";
import { stripJosa } from "../../../src/shared/indexing/keyword-search/josa.js";
import { filterByRelativeFloor, uniqueDensePaths } from "./baseline.js";
import type {
	AlgorithmContext,
	EvalDocument,
	KeywordCandidate,
	SearchAlgorithm,
} from "./types.js";

const INDEX_TOKEN = /[a-z0-9가-힣]+/g;
const HANGUL_RUN = /[가-힣]{2,}/g;
const EMBEDDED_DATA_URI =
	/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;

const BM25F_K1 = 1.2;
const RRF_K = 60;
const STEM_PREFIX = "~";
const BIGRAM_PREFIX = "bg:";

interface FieldConfig {
	weight: number;
	b: number;
}

const FIELDS = {
	title: { weight: 3.0, b: 0.5 },
	tags: { weight: 2.0, b: 0.3 },
	body: { weight: 1.0, b: 0.75 },
} as const satisfies Record<string, FieldConfig>;

type FieldName = keyof typeof FIELDS;

interface QueryTerm {
	term: string;
	weight: number;
}

interface DocFieldStats {
	relPath: string;
	lengths: Record<FieldName, number>;
	counts: Record<FieldName, Map<string, number>>;
}

function increment(map: Map<string, number>, key: string): void {
	map.set(key, (map.get(key) ?? 0) + 1);
}

export function extractFieldTerms(
	rawText: string,
	includeBigrams: boolean,
): { length: number; counts: Map<string, number> } {
	const cleaned = rawText
		.normalize("NFC")
		.replace(EMBEDDED_DATA_URI, " ")
		.toLowerCase();
	const words = cleaned.match(INDEX_TOKEN) ?? [];
	const counts = new Map<string, number>();

	for (const word of words) {
		increment(counts, word);
		const stem = stripJosa(word);
		if (stem !== word) {
			increment(counts, STEM_PREFIX + stem);
		}
		if (includeBigrams) {
			const hangulRuns = stem.match(HANGUL_RUN) ?? [];
			for (const run of hangulRuns) {
				for (let i = 0; i < run.length - 1; i++) {
					increment(counts, BIGRAM_PREFIX + run.slice(i, i + 2));
				}
			}
		}
	}

	return { length: words.length, counts };
}

export function extractQueryTerms(
	query: string,
	options: {
		stemWeight: number;
		bigramWeight: number;
		includeBigrams: boolean;
	},
): QueryTerm[][] {
	const words = query.normalize("NFC").toLowerCase().match(INDEX_TOKEN) ?? [];
	const units: QueryTerm[][] = [];

	for (const word of words) {
		const alts: QueryTerm[] = [
			{ term: word, weight: 1.0 },
			{ term: STEM_PREFIX + word, weight: options.stemWeight },
		];
		const stem = stripJosa(word);
		if (stem !== word) {
			alts.push(
				{ term: stem, weight: options.stemWeight },
				{ term: STEM_PREFIX + stem, weight: options.stemWeight },
			);
		}
		units.push(alts);

		if (options.includeBigrams) {
			const hangulRuns = stem.match(HANGUL_RUN) ?? [];
			for (const run of hangulRuns) {
				if (run.length < 3) continue;
				for (let i = 0; i < run.length - 1; i++) {
					units.push([
						{
							term: BIGRAM_PREFIX + run.slice(i, i + 2),
							weight: options.bigramWeight,
						},
					]);
				}
			}
		}
	}

	return units;
}

export class Bm25fBigramIndex {
	private docs: DocFieldStats[] = [];
	private postings = new Map<string, number[]>();
	private avgLengths: Record<FieldName, number> = {
		title: 1,
		tags: 1,
		body: 1,
	};
	private includeBigrams: boolean;

	constructor(documents: EvalDocument[], includeBigrams = true) {
		this.includeBigrams = includeBigrams;
		const totals: Record<FieldName, number> = { title: 0, tags: 0, body: 0 };

		documents.forEach((doc, docId) => {
			const fileStem = basename(doc.relPath, extname(doc.relPath));
			const titleText = `${doc.title} ${fileStem}`;
			const tagsText = doc.tags.join(" ");

			const titleTerms = extractFieldTerms(titleText, includeBigrams);
			const tagsTerms = extractFieldTerms(tagsText, includeBigrams);
			const bodyTerms = extractFieldTerms(doc.body, includeBigrams);

			totals.title += titleTerms.length;
			totals.tags += tagsTerms.length;
			totals.body += bodyTerms.length;

			const stats: DocFieldStats = {
				relPath: doc.relPath,
				lengths: {
					title: titleTerms.length,
					tags: tagsTerms.length,
					body: bodyTerms.length,
				},
				counts: {
					title: titleTerms.counts,
					tags: tagsTerms.counts,
					body: bodyTerms.counts,
				},
			};
			this.docs.push(stats);

			const docTerms = new Set<string>([
				...titleTerms.counts.keys(),
				...tagsTerms.counts.keys(),
				...bodyTerms.counts.keys(),
			]);
			for (const term of docTerms) {
				const list = this.postings.get(term);
				if (list) {
					list.push(docId);
				} else {
					this.postings.set(term, [docId]);
				}
			}
		});

		const count = Math.max(1, this.docs.length);
		this.avgLengths = {
			title: Math.max(1, totals.title / count),
			tags: Math.max(1, totals.tags / count),
			body: Math.max(1, totals.body / count),
		};
	}

	public search(
		query: string,
		options: { stemWeight?: number; bigramWeight?: number } = {},
	): KeywordCandidate[] {
		const units = extractQueryTerms(query, {
			stemWeight: options.stemWeight ?? 0.7,
			bigramWeight: options.bigramWeight ?? 0.35,
			includeBigrams: this.includeBigrams,
		});
		if (units.length === 0 || this.docs.length === 0) return [];

		const docScores = new Map<number, number>();
		const totalDocs = this.docs.length;

		for (const alts of units) {
			const bestForUnit = new Map<number, number>();

			for (const { term, weight } of alts) {
				const docIds = this.postings.get(term);
				if (!docIds || docIds.length === 0) continue;

				const df = docIds.length;
				const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));

				for (const docId of docIds) {
					const doc = this.docs[docId];
					if (!doc) continue;

					let pseudoTf = 0;
					for (const field of ["title", "tags", "body"] as const) {
						const tf = doc.counts[field].get(term) ?? 0;
						if (tf === 0) continue;
						const { weight: fieldWeight, b } = FIELDS[field];
						const lengthNorm =
							1 - b + b * (doc.lengths[field] / this.avgLengths[field]);
						pseudoTf += (fieldWeight * tf) / lengthNorm;
					}

					const score =
						weight *
						idf *
						((pseudoTf * (BM25F_K1 + 1)) / (pseudoTf + BM25F_K1));
					if (score > (bestForUnit.get(docId) ?? 0)) {
						bestForUnit.set(docId, score);
					}
				}
			}

			for (const [docId, score] of bestForUnit) {
				docScores.set(docId, (docScores.get(docId) ?? 0) + score);
			}
		}

		return [...docScores.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([docId, score]) => ({
				relPath: this.docs[docId]?.relPath ?? "",
				score,
			}));
	}
}

const indexCache = new WeakMap<
	EvalDocument[],
	Map<boolean, Bm25fBigramIndex>
>();

function getOrBuildIndex(
	documents: EvalDocument[],
	includeBigrams: boolean,
): Bm25fBigramIndex {
	let byFlag = indexCache.get(documents);
	if (!byFlag) {
		byFlag = new Map();
		indexCache.set(documents, byFlag);
	}
	let index = byFlag.get(includeBigrams);
	if (!index) {
		index = new Bm25fBigramIndex(documents, includeBigrams);
		byFlag.set(includeBigrams, index);
	}
	return index;
}

export function createBm25fBigramOnly(options: {
	name: string;
	includeBigrams?: boolean;
}): SearchAlgorithm {
	const includeBigrams = options.includeBigrams ?? true;

	return {
		name: options.name,
		description: `BM25F (bigrams=${includeBigrams}) only`,
		run(ctx: AlgorithmContext): string[] {
			const index = getOrBuildIndex(ctx.documents, includeBigrams);
			return index
				.search(ctx.query)
				.slice(0, ctx.limit)
				.map((hit) => hit.relPath);
		},
	};
}

export function createBm25fBigramHybrid(options: {
	name: string;
	includeBigrams?: boolean;
	minRelativeScore?: number;
}): SearchAlgorithm {
	const includeBigrams = options.includeBigrams ?? true;
	const minRelativeScore = options.minRelativeScore ?? 0.7;

	return {
		name: options.name,
		description: `BM25F (bigrams=${includeBigrams}) + Dense RRF`,
		run(ctx: AlgorithmContext): string[] {
			const index = getOrBuildIndex(ctx.documents, includeBigrams);
			const semanticWindow = ctx.denseHits.slice(0, ctx.limit * 3);
			const keywordHits = filterByRelativeFloor(
				index.search(ctx.query),
				semanticWindow.length > 0 ? minRelativeScore : 0,
			);

			const scores = new Map<string, number>();
			keywordHits.forEach((hit, rank) => {
				scores.set(hit.relPath, 1 / (RRF_K + rank + 1));
			});
			uniqueDensePaths(semanticWindow).forEach((relPath, rank) => {
				scores.set(
					relPath,
					(scores.get(relPath) ?? 0) + 1 / (RRF_K + rank + 1),
				);
			});

			return [...scores.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, ctx.limit)
				.map(([relPath]) => relPath);
		},
	};
}
