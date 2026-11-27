import { basename } from "node:path";
import type { ChunkMetadata } from "@shared/indexing/VectorDB.js";
import type { DocumentIndex } from "@shared/markdown/types.js";
import type { DenseHit, HybridSearchResult, KeywordHitInput } from "./types.js";

export const RRF_K = 60;
export const KEYWORD_FUSION_MIN_RELATIVE_SCORE = 0.7;

function toKeywordChunk(
	document: DocumentIndex,
	content: string,
): ChunkMetadata {
	const { frontmatter, filePath } = document;
	return {
		id: `${filePath}_keyword_chunk`,
		filePath,
		fileName: basename(filePath),
		chunkIndex: -1,
		content,
		metadata: {
			title: frontmatter.title,
			date:
				frontmatter.date instanceof Date
					? frontmatter.date.toISOString()
					: (frontmatter.date ?? ""),
			tags: frontmatter.tags?.join(", ") ?? "",
			summary: frontmatter.summary ?? "",
			slug: frontmatter.slug ?? "",
			category: frontmatter.category ?? "any",
			completed: frontmatter.completed ?? false,
		},
	};
}

export function keywordChunksOf({
	document,
	chunk,
}: KeywordHitInput): ChunkMetadata[] {
	return chunk ? [toKeywordChunk(document, chunk)] : [];
}

export function fuseRrf({
	keywordHits,
	denseHits,
	resolveDocument,
	limit,
}: {
	keywordHits: KeywordHitInput[];
	denseHits: DenseHit[];
	resolveDocument: (filePath: string) => DocumentIndex | null;
	limit: number;
}): HybridSearchResult[] {
	const keywordScoreFloor =
		denseHits.length > 0
			? Math.max(0, ...keywordHits.map((hit) => hit.score)) *
				KEYWORD_FUSION_MIN_RELATIVE_SCORE
			: 0;
	const keywordTexts = new Map(
		keywordHits.map((hit) => [hit.document.filePath, hit.chunk]),
	);
	const fused = new Map<
		string,
		{
			score: number;
			document: DocumentIndex;
			matchedChunks: ChunkMetadata[];
			keywordChunks: ChunkMetadata[];
		}
	>();

	keywordHits
		.filter((hit) => hit.score >= keywordScoreFloor)
		.forEach((hit, rank) => {
			fused.set(hit.document.filePath, {
				score: 1 / (RRF_K + rank + 1),
				document: hit.document,
				matchedChunks: [],
				keywordChunks: keywordChunksOf(hit),
			});
		});

	const seenPaths = new Set<string>();
	for (const { filePath, chunk } of denseHits) {
		if (seenPaths.has(filePath)) {
			fused.get(filePath)?.matchedChunks.push(chunk);
			continue;
		}
		seenPaths.add(filePath);
		const denseScore = 1 / (RRF_K + seenPaths.size);

		const existing = fused.get(filePath);
		if (existing) {
			existing.score += denseScore;
			existing.matchedChunks.push(chunk);
			continue;
		}
		const document = resolveDocument(filePath);
		if (document) {
			fused.set(filePath, {
				score: denseScore,
				document,
				matchedChunks: [chunk],
				keywordChunks: [],
			});
		}
	}

	return Array.from(fused.values())
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(({ score, document, matchedChunks, keywordChunks }) => ({
			score,
			document,
			matchedChunks: matchedChunks.length > 0 ? matchedChunks : keywordChunks,
			keywordText: keywordTexts.get(document.filePath) ?? null,
			finalScore: score,
		}));
}
