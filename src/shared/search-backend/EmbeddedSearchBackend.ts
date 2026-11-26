import type { Indexer } from "@shared/indexing/Indexer.js";
import type { ChunkMetadata } from "@shared/indexing/VectorDB.js";
import {
	SEARCH_SETUP_COMMAND,
	type SearchStatus,
} from "@shared/searchStatus.js";
import { isLowConfidence } from "./lowConfidence.js";
import { fuseRrf, keywordChunksOf } from "./scoreFusion.js";
import type { DenseHit, SearchBackend } from "./types.js";

type SemanticChunk = ChunkMetadata & { _distance: number };

function toDenseHit(chunk: SemanticChunk): DenseHit {
	return {
		filePath: chunk.filePath,
		similarity: Math.max(0, Math.min(1, 1 - chunk._distance)),
		chunk,
	};
}

export class EmbeddedSearchBackend implements SearchBackend {
	constructor(
		private readonly dependencies: {
			indexer: Pick<Indexer, "searchWithChunks" | "getDocument">;
			isLocalAIReady: () => boolean;
			semanticSearch: (
				query: string,
				limit: number,
			) => Promise<SemanticChunk[]>;
			lowConfidenceThreshold: number;
		},
	) {}

	async search(
		query: string,
		limit: number,
	): ReturnType<SearchBackend["search"]> {
		const { indexer, isLocalAIReady, semanticSearch, lowConfidenceThreshold } =
			this.dependencies;

		if (!isLocalAIReady()) {
			return {
				results: indexer
					.searchWithChunks(query)
					.slice(0, limit)
					.map((hit) => ({
						score: 1.0,
						document: hit.document,
						matchedChunks: keywordChunksOf(hit),
						finalScore: 1.0,
					})),
				searchStatus: {
					mode: "keyword",
					reason: "models_missing",
					setup_command: SEARCH_SETUP_COMMAND,
				},
			};
		}

		const denseHits = (await semanticSearch(query, limit * 3)).map(toDenseHit);
		const keywordHits = indexer.searchWithChunks(query);
		const hasSemanticSearch = denseHits.length > 0;

		const lowConfidence = isLowConfidence({
			hasSemanticSearch,
			topDenseSimilarity: denseHits[0]?.similarity ?? 0,
			topBm25Score: keywordHits[0]?.score ?? 0,
			threshold: lowConfidenceThreshold,
		});

		let searchStatus: SearchStatus = { mode: "hybrid" };
		if (!hasSemanticSearch) {
			searchStatus = { mode: "keyword", reason: "semantic_unavailable" };
		} else if (lowConfidence) {
			searchStatus = { mode: "hybrid", reason: "low_confidence" };
		}

		return {
			results: fuseRrf({
				keywordHits,
				denseHits,
				resolveDocument: (filePath) => indexer.getDocument(filePath),
				limit,
			}),
			searchStatus,
		};
	}
}
