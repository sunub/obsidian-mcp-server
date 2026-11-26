import path from "node:path";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { parse as parseMatter } from "@shared/markdown/MatterParser.js";
import { stripEmbeddedData } from "@shared/markdown/stripEmbeddedData.js";
import type { HeadingEntry } from "../types.js";
import type { ChunkMetadata } from "../VectorDB.js";

export interface ChunkingWorkerInput {
	filePath: string;
	fileContent: string;
	birthTime: string;
}
export const CHUNK_SIZE = 256;
export const CHUNK_OVERLAP = 32;

function extractHeadingsWithPositions(body: string): HeadingEntry[] {
	const headingRegex = /^(#{1,3})\s+(.+)$/gm;
	const results: HeadingEntry[] = [];
	for (const match of body.matchAll(headingRegex)) {
		results.push({
			heading: (match[2] as string).trim(),
			pos: match.index ?? 0,
			depth: (match[1] as string).length,
		});
	}
	return results;
}

function locateChunk(body: string, chunk: string, searchFrom: number): number {
	const found = body.indexOf(chunk.slice(0, 60), searchFrom);
	return found === -1 ? searchFrom : found;
}

function sectionAt(headings: HeadingEntry[], pos: number): string | null {
	let section: string | null = null;
	for (const h of headings) {
		if (h.pos <= pos) section = h.heading;
	}
	return section;
}

export function createDocumentChunker(
	lengthFunction: (text: string) => number,
) {
	const splitter = RecursiveCharacterTextSplitter.fromLanguage(
		"markdown",

		{
			chunkSize: CHUNK_SIZE,
			chunkOverlap: CHUNK_OVERLAP,
			lengthFunction,
		},
	);

	return async function chunkDocument({
		filePath,
		fileContent,
		birthTime,
	}: ChunkingWorkerInput): Promise<ChunkMetadata[]> {
		const fileName = path.basename(filePath);
		const { frontmatter, content } = parseMatter(
			filePath,
			birthTime,
			fileContent,
		);
		const body = stripEmbeddedData(content);

		const headings = extractHeadingsWithPositions(body);
		const titleFromBody = headings.find((h) => h.depth === 1)?.heading ?? null;
		const docTitle = frontmatter.title || titleFromBody || fileName;
		const docStructure = headings
			.filter((h) => h.depth <= 2)
			.slice(0, 4)
			.map((h) => h.heading.slice(0, 25));

		const chunks = await splitter.splitText(body);

		let searchFrom = 0;
		return chunks.map((chunk, i) => {
			const chunkStart = locateChunk(body, chunk, searchFrom);
			searchFrom = chunkStart + 1;
			const sectionHeading =
				headings.length === 0 ? null : sectionAt(headings, chunkStart);
			const context = [
				sectionHeading ? `Section: ${sectionHeading.slice(0, 30)}` : "",
				docStructure.length > 1
					? `Outline: ${docStructure.slice(0, 3).join(" > ")}`
					: "",
			]
				.filter(Boolean)
				.join("\n");

			return {
				id: `${filePath}_chunk_${i}`,
				filePath,
				fileName,
				chunkIndex: i,
				content: chunk,
				context,
				metadata: {
					title: docTitle,
					date:
						frontmatter.date instanceof Date
							? frontmatter.date.toISOString()
							: frontmatter.date || birthTime,
					tags: frontmatter.tags?.join(", ") ?? "",
					summary: frontmatter.summary || "",
					slug: frontmatter.slug || "",
					category: frontmatter.category || "any",
					completed: frontmatter.completed ?? false,
				},
			};
		});
	};
}
