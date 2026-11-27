export interface KeywordCandidate {
	relPath: string;
	score: number;
}

export interface DenseCandidate {
	relPath: string;
	distance: number;
	similarity: number;
	chunkContent: string;
}

export interface EvalDocument {
	relPath: string;
	title: string;
	tags: string[];
	body: string;
}

export interface LinkGraph {
	outLinks: Map<string, string[]>;
	inLinks: Map<string, string[]>;
}

export interface AlgorithmContext {
	query: string;
	limit: number;
	keywordHits: KeywordCandidate[];
	denseHits: DenseCandidate[];
	graph: LinkGraph;
	documents: EvalDocument[];
	vaultPath: string;
	embed: (text: string) => Promise<number[]>;
	searchVector: (vector: number[], limit: number) => Promise<DenseCandidate[]>;
	searchKeyword: (
		query: string,
		minRelativeScore?: number,
	) => KeywordCandidate[];
}

export interface SearchAlgorithm {
	name: string;
	description: string;
	run: (ctx: AlgorithmContext) => Promise<string[]> | string[];
}

export interface EvalQuery {
	id: string;
	type: string;
	query: string;
	relevant: string[];
	relevant_lenient?: string[];
	grades?: Record<string, 0 | 1 | 2>;
}

export interface EvalDataset {
	name: string;
	queries: EvalQuery[];
	useLenient: boolean;
}
