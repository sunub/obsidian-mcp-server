import path from "node:path";
import { parentPort } from "node:worker_threads";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { encodingForModel } from "js-tiktoken";
import { parse as parseMatter } from "../processor/MatterParser.js";
import type { HeadingEntry } from "../RAGIndexer.js";
import type { ChunkMetadata } from "../VectorDB.js";

export interface ChunkingWorkerInput {
	filePath: string;
	fileContent: string;
	birthTime: string;
}

export interface ChunkingWorkerOutput {
	success: boolean;
	records?: ChunkMetadata[];
	error?: string;
}

const enc = encodingForModel("gpt-3.5-turbo");
const splitter = new RecursiveCharacterTextSplitter({
	chunkSize: 500,
	chunkOverlap: 50,
	lengthFunction: (text: string) => enc.encode(text).length,
});

function extractHeadingsWithPositions(body: string): HeadingEntry[] {
	const headingRegex = /^(#{1,3})\s+(.+)$/gm;
	const results: HeadingEntry[] = [];
	const matches = body.matchAll(headingRegex);
	for (const match of matches) {
		results.push({
			heading: match[2].trim(),
			pos: match.index ?? 0,
			depth: match[1].length,
		});
	}
	return results;
}

function findSectionForChunk(
	body: string,
	chunk: string,
	headings: HeadingEntry[],
): string | null {
	if (headings.length === 0) return null;
	const pos = body.indexOf(chunk.slice(0, 60));
	if (pos === -1) return null;
	let section: string | null = null;
	for (const h of headings) {
		if (h.pos <= pos) section = h.heading;
	}
	return section;
}

parentPort?.on("message", async (data: ChunkingWorkerInput) => {
	const { filePath, fileContent, birthTime } = data;
	const fileName = path.basename(filePath);

	try {
		const { frontmatter, content: body } = parseMatter(
			filePath,
			birthTime,
			fileContent,
		);

		const headings = extractHeadingsWithPositions(body);
		const titleFromBody = headings.find((h) => h.depth === 1)?.heading ?? null;
		const docTitle = frontmatter.title || titleFromBody || fileName;
		const docStructure = headings
			.filter((h) => h.depth <= 2)
			.slice(0, 4)
			.map((h) => h.heading.slice(0, 25));

		const chunks = await splitter.splitText(body);
		const records: ChunkMetadata[] = [];

		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			const sectionHeading = findSectionForChunk(body, chunk, headings);
			const context = [
				sectionHeading ? `Section: ${sectionHeading.slice(0, 30)}` : "",
				docStructure.length > 1
					? `Outline: ${docStructure.slice(0, 3).join(" > ")}`
					: "",
			]
				.filter(Boolean)
				.join("\n");

			records.push({
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
			});
		}

		const response: ChunkingWorkerOutput = { success: true, records };
		parentPort?.postMessage(response);
	} catch (error: unknown) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		const response: ChunkingWorkerOutput = { success: false, error: errorMsg };
		parentPort?.postMessage(response);
	}
});
