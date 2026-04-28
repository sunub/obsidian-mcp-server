import type { DocumentIndex } from "../processor/types.js";

export interface EnrichedDocument extends DocumentIndex {
	content: string;
	contentHash?: string;
	stats?: {
		wordCount: number;
		lineCount: number;
		characterCount: number;
		contentLength: number;
		hasContent: boolean;
	};
	backlinks?: {
		filePath: string;
		title: string;
	}[];
}
