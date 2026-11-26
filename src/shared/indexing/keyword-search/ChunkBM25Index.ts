import { splitIntoChunks } from "./chunkText.js";
import { PostingList } from "./PostingList.js";
import {
	countTerms,
	parseQuery,
	type QueryUnit,
	type TermCounts,
	type WeightedTerm,
} from "./tokenize.js";
import { grow } from "./typedArrays.js";
import type { KeywordDocument, KeywordHit } from "./types.js";

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const MARKDOWN_EXTENSION = /\.mdx?$/;
const INITIAL_CAPACITY = 1024;
const MIN_DEAD_CHUNKS_FOR_COMPACTION = 1000;
const DEAD_CHUNK_RATIO_FOR_COMPACTION = 0.25;

interface FileMatch {
	bestScore: number;
	bestBodyScore: number;
	bestBodyChunkId: number | null;
	matchedUnits: number;
}

function requiredUnitMatches(unitCount: number): number {
	if (unitCount <= 2) return 1;
	if (unitCount <= 4) return 2;
	return Math.floor(unitCount * 0.5);
}

function fileNameWithoutExtension(filePath: string): string {
	const name = filePath.split(/[/\\]/).pop() ?? "";
	return name.normalize("NFC").toLowerCase().replace(MARKDOWN_EXTENSION, "");
}

function maxScore(
	scoresByChunk: Map<number, number>,
	chunkId: number,
	score: number,
): void {
	if (score > (scoresByChunk.get(chunkId) ?? 0)) {
		scoresByChunk.set(chunkId, score);
	}
}

export class ChunkBM25Index {
	private termIds = new Map<string, number>();
	private postings: PostingList[] = [];

	private chunkFile = new Int32Array(INITIAL_CAPACITY);
	private chunkLength = new Int32Array(INITIAL_CAPACITY);
	private chunkAlive = new Uint8Array(INITIAL_CAPACITY);
	private chunkTermStart = new Int32Array(INITIAL_CAPACITY);
	private chunkTermCount = new Int32Array(INITIAL_CAPACITY);
	private chunkText: (string | null)[] = [];
	private termPool = new Int32Array(INITIAL_CAPACITY);
	private termPoolLength = 0;
	private nextChunkId = 0;
	private aliveChunkCount = 0;
	private totalLength = 0;

	private fileIdByPath = new Map<string, number>();
	private filePaths: string[] = [];
	private fileFirstChunk = new Int32Array(INITIAL_CAPACITY);
	private fileChunkCount = new Int32Array(INITIAL_CAPACITY);

	public addDocument(document: KeywordDocument): void {
		this.removeDocument(document.filePath);
		const fileId = this.fileIdOf(document.filePath);
		const fileName = fileNameWithoutExtension(document.filePath);
		const metadataTerms = countTerms(
			[document.title, fileName, ...document.tags].join(" "),
			[
				fileName,
				...document.tags.map((tag) => tag.normalize("NFC").toLowerCase()),
				...document.title
					.normalize("NFC")
					.toLowerCase()
					.split(/\s+/)
					.filter((token) => token.length > 0),
			],
		);

		const firstChunkId = this.nextChunkId;
		this.addChunk(fileId, null, metadataTerms);
		for (const text of splitIntoChunks(document.body)) {
			this.addChunk(fileId, text, countTerms(text));
		}
		this.fileFirstChunk[fileId] = firstChunkId;
		this.fileChunkCount[fileId] = this.nextChunkId - firstChunkId;
	}

	public removeDocument(filePath: string): void {
		const fileId = this.fileIdByPath.get(filePath);
		if (fileId === undefined) return;
		const first = this.fileFirstChunk[fileId] ?? 0;
		const end = first + (this.fileChunkCount[fileId] ?? 0);
		for (let chunkId = first; chunkId < end; chunkId++) {
			this.killChunk(chunkId);
		}
		this.fileChunkCount[fileId] = 0;
		if (this.shouldCompact()) this.compact();
	}

	public clear(): void {
		this.termIds.clear();
		this.postings = [];
		this.chunkFile = new Int32Array(INITIAL_CAPACITY);
		this.chunkLength = new Int32Array(INITIAL_CAPACITY);
		this.chunkAlive = new Uint8Array(INITIAL_CAPACITY);
		this.chunkTermStart = new Int32Array(INITIAL_CAPACITY);
		this.chunkTermCount = new Int32Array(INITIAL_CAPACITY);
		this.chunkText = [];
		this.termPool = new Int32Array(INITIAL_CAPACITY);
		this.termPoolLength = 0;
		this.nextChunkId = 0;
		this.aliveChunkCount = 0;
		this.totalLength = 0;
		this.fileIdByPath.clear();
		this.filePaths = [];
		this.fileFirstChunk = new Int32Array(INITIAL_CAPACITY);
		this.fileChunkCount = new Int32Array(INITIAL_CAPACITY);
	}

	public search(query: string): KeywordHit[] {
		const units = parseQuery(query);
		if (units.length === 0 || this.aliveChunkCount === 0) return [];

		const chunkTotals = new Map<number, number>();
		const filesByUnit = units.map(() => new Set<number>());
		units.forEach((unit, unitIndex) => {
			for (const [chunkId, score] of this.scoreUnit(unit)) {
				chunkTotals.set(chunkId, (chunkTotals.get(chunkId) ?? 0) + score);
				filesByUnit[unitIndex]?.add(this.chunkFile[chunkId] ?? 0);
			}
		});

		const fileMatches = this.bestChunkPerFile(chunkTotals);
		for (const files of filesByUnit) {
			for (const fileId of files) {
				const match = fileMatches.get(fileId);
				if (match) match.matchedUnits += 1;
			}
		}

		const required = requiredUnitMatches(units.length);
		return [...fileMatches.entries()]
			.filter(([, match]) => match.matchedUnits >= required)
			.sort(([, a], [, b]) => b.bestScore - a.bestScore)
			.map(([fileId, match]) => ({
				filePath: this.filePaths[fileId] ?? "",
				score: match.bestScore,
				chunk:
					match.bestBodyChunkId === null
						? null
						: (this.chunkText[match.bestBodyChunkId] ?? null),
			}));
	}

	private fileIdOf(filePath: string): number {
		const existing = this.fileIdByPath.get(filePath);
		if (existing !== undefined) return existing;
		const fileId = this.filePaths.length;
		this.filePaths.push(filePath);
		this.fileIdByPath.set(filePath, fileId);
		this.fileFirstChunk = grow(this.fileFirstChunk, fileId + 1);
		this.fileChunkCount = grow(this.fileChunkCount, fileId + 1);
		return fileId;
	}

	private termIdOf(term: string): number {
		const existing = this.termIds.get(term);
		if (existing !== undefined) return existing;
		const termId = this.postings.length;
		this.termIds.set(term, termId);
		this.postings.push(new PostingList());
		return termId;
	}

	private addChunk(
		fileId: number,
		text: string | null,
		terms: TermCounts,
	): void {
		const chunkId = this.nextChunkId++;
		const termCount = terms.counts.size;
		this.chunkFile = grow(this.chunkFile, chunkId + 1);
		this.chunkLength = grow(this.chunkLength, chunkId + 1);
		this.chunkAlive = grow(this.chunkAlive, chunkId + 1);
		this.chunkTermStart = grow(this.chunkTermStart, chunkId + 1);
		this.chunkTermCount = grow(this.chunkTermCount, chunkId + 1);
		this.termPool = grow(this.termPool, this.termPoolLength + termCount);

		this.chunkFile[chunkId] = fileId;
		this.chunkLength[chunkId] = terms.length;
		this.chunkAlive[chunkId] = 1;
		this.chunkTermStart[chunkId] = this.termPoolLength;
		this.chunkTermCount[chunkId] = termCount;
		this.chunkText[chunkId] = text;
		this.aliveChunkCount += 1;
		this.totalLength += terms.length;

		for (const [term, frequency] of terms.counts) {
			const termId = this.termIdOf(term);
			this.termPool[this.termPoolLength++] = termId;
			this.postings[termId]?.append(chunkId, frequency);
		}
	}

	private killChunk(chunkId: number): void {
		if (!this.chunkAlive[chunkId]) return;
		this.chunkAlive[chunkId] = 0;
		this.aliveChunkCount -= 1;
		this.totalLength -= this.chunkLength[chunkId] ?? 0;
		this.chunkText[chunkId] = null;
		const start = this.chunkTermStart[chunkId] ?? 0;
		const end = start + (this.chunkTermCount[chunkId] ?? 0);
		for (let i = start; i < end; i++) {
			this.postings[this.termPool[i] ?? 0]?.markRemoved();
		}
	}

	private shouldCompact(): boolean {
		const dead = this.nextChunkId - this.aliveChunkCount;
		return (
			dead >= MIN_DEAD_CHUNKS_FOR_COMPACTION &&
			dead > this.aliveChunkCount * DEAD_CHUNK_RATIO_FOR_COMPACTION
		);
	}

	private compact(): void {
		const remap = new Int32Array(this.nextChunkId).fill(-1);
		let survivors = 0;
		for (let chunkId = 0; chunkId < this.nextChunkId; chunkId++) {
			if (this.chunkAlive[chunkId]) remap[chunkId] = survivors++;
		}

		const chunkFile = new Int32Array(survivors);
		const chunkLength = new Int32Array(survivors);
		const chunkAlive = new Uint8Array(survivors).fill(1);
		const chunkTermStart = new Int32Array(survivors);
		const chunkTermCount = new Int32Array(survivors);
		const chunkText: (string | null)[] = new Array(survivors);
		let poolSize = 0;
		for (let chunkId = 0; chunkId < this.nextChunkId; chunkId++) {
			if (remap[chunkId] >= 0) poolSize += this.chunkTermCount[chunkId] ?? 0;
		}
		const termPool = new Int32Array(poolSize);
		let poolCursor = 0;
		for (let chunkId = 0; chunkId < this.nextChunkId; chunkId++) {
			const next = remap[chunkId] ?? -1;
			if (next < 0) continue;
			const start = this.chunkTermStart[chunkId] ?? 0;
			const count = this.chunkTermCount[chunkId] ?? 0;
			chunkFile[next] = this.chunkFile[chunkId] ?? 0;
			chunkLength[next] = this.chunkLength[chunkId] ?? 0;
			chunkTermStart[next] = poolCursor;
			chunkTermCount[next] = count;
			chunkText[next] = this.chunkText[chunkId] ?? null;
			termPool.set(this.termPool.subarray(start, start + count), poolCursor);
			poolCursor += count;
		}

		for (const posting of this.postings) posting.compact(remap);
		for (let fileId = 0; fileId < this.filePaths.length; fileId++) {
			if ((this.fileChunkCount[fileId] ?? 0) > 0) {
				this.fileFirstChunk[fileId] =
					remap[this.fileFirstChunk[fileId] ?? 0] ?? 0;
			}
		}

		this.chunkFile = chunkFile;
		this.chunkLength = chunkLength;
		this.chunkAlive = chunkAlive;
		this.chunkTermStart = chunkTermStart;
		this.chunkTermCount = chunkTermCount;
		this.chunkText = chunkText;
		this.termPool = termPool;
		this.termPoolLength = poolSize;
		this.nextChunkId = survivors;
	}

	private bestChunkPerFile(
		chunkTotals: Map<number, number>,
	): Map<number, FileMatch> {
		const matches = new Map<number, FileMatch>();
		for (const [chunkId, score] of chunkTotals) {
			const fileId = this.chunkFile[chunkId] ?? 0;
			const match = matches.get(fileId) ?? {
				bestScore: 0,
				bestBodyScore: 0,
				bestBodyChunkId: null,
				matchedUnits: 0,
			};
			match.bestScore = Math.max(match.bestScore, score);
			if (this.chunkText[chunkId] !== null && score > match.bestBodyScore) {
				match.bestBodyScore = score;
				match.bestBodyChunkId = chunkId;
			}
			matches.set(fileId, match);
		}
		return matches;
	}

	private scoreUnit(unit: QueryUnit): Map<number, number> {
		const scores = new Map<number, number>();
		for (const { term, weight } of unit.alternatives) {
			for (const [chunkId, score] of this.scoreTerm(term)) {
				maxScore(scores, chunkId, score * weight);
			}
		}
		for (const [chunkId, score] of this.scoreAllParts(unit.partAlternatives)) {
			maxScore(scores, chunkId, score);
		}
		return scores;
	}

	private scoreAllParts(
		partAlternatives: WeightedTerm[][],
	): Map<number, number> {
		if (partAlternatives.length === 0) return new Map();
		const perPart = partAlternatives.map((alternatives) => {
			const best = new Map<number, number>();
			for (const { term, weight } of alternatives) {
				for (const [chunkId, score] of this.scoreTerm(term)) {
					maxScore(best, chunkId, score * weight);
				}
			}
			return best;
		});
		const [smallest, ...others] = [...perPart].sort((a, b) => a.size - b.size);
		const scores = new Map<number, number>();
		for (const [chunkId, score] of smallest ?? []) {
			let lowest = score;
			let inAllParts = true;
			for (const other of others) {
				const otherScore = other.get(chunkId);
				if (otherScore === undefined) {
					inAllParts = false;
					break;
				}
				lowest = Math.min(lowest, otherScore);
			}
			if (inAllParts) scores.set(chunkId, lowest);
		}
		return scores;
	}

	private scoreTerm(term: string): Map<number, number> {
		const scores = new Map<number, number>();
		const termId = this.termIds.get(term);
		const posting = termId === undefined ? undefined : this.postings[termId];
		if (!posting || posting.liveCount === 0) return scores;
		const averageLength = this.totalLength / this.aliveChunkCount;
		const idf = Math.log(
			1 +
				(this.aliveChunkCount - posting.liveCount + 0.5) /
					(posting.liveCount + 0.5),
		);
		for (let i = 0; i < posting.length; i++) {
			const chunkId = posting.ids[i] ?? 0;
			if (!this.chunkAlive[chunkId]) continue;
			const termFrequency = posting.frequencies[i] ?? 0;
			const lengthNorm =
				1 -
				BM25_B +
				BM25_B * ((this.chunkLength[chunkId] ?? 0) / averageLength);
			scores.set(
				chunkId,
				(idf * termFrequency * (BM25_K1 + 1)) /
					(termFrequency + BM25_K1 * lengthNorm),
			);
		}
		return scores;
	}
}
