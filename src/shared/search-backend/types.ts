import type { ChunkMetadata } from "@shared/indexing/VectorDB.js";
import type { DocumentIndex } from "@shared/markdown/types.js";
import type { SearchStatus } from "@shared/searchStatus.js";

export interface DenseHit {
	filePath: string;
	similarity: number;
	chunk: ChunkMetadata;
}

export interface KeywordHitInput {
	document: DocumentIndex;
	score: number;
	chunk: string | null;
}

export interface HybridSearchResult {
	score: number;
	document: DocumentIndex;
	matchedChunks: ChunkMetadata[];
	keywordText: string | null;
	finalScore: number;
}

export interface SearchBackend {
	search(
		query: string,
		limit: number,
	): Promise<{
		results: HybridSearchResult[];
		searchStatus: SearchStatus;
	}>;
}
