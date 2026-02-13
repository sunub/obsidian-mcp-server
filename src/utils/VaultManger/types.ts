import { DocumentIndex } from "../processor/types.js";

export interface EnrichedDocument extends DocumentIndex {
  content: string;
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