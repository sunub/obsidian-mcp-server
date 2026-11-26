export interface KeywordDocument {
	filePath: string;
	title: string;
	tags: string[];
	body: string;
}

export interface KeywordHit {
	filePath: string;
	score: number;
	chunk: string | null;
}
