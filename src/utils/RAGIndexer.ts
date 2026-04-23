import fs from "node:fs/promises";
import path from "node:path";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { encodingForModel } from "js-tiktoken";
import ora, { type Ora } from "ora";
import { localEmbedder } from "./Embedder.js";
import { DirectoryWalker } from "./DirectoryWalker.js";
import { llmClient } from "./LLMClient.js";
import { parse as parseMatter } from "./processor/MatterParser.js";
import { Semaphore } from "./semaphore.js";
import { type VectorRecord, vectorDB } from "./VectorDB.js";

type HeadingEntry = { heading: string; pos: number; depth: number };

function extractHeadingsWithPositions(body: string): HeadingEntry[] {
	const headingRegex = /^(#{1,3})\s+(.+)$/gm;
	const results: HeadingEntry[] = [];
	const matches = body.matchAll(headingRegex);
	for (const match of matches) {
		results.push({
			heading: match[2].trim(),
			pos: match.index,
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

export class RAGIndexer {
	private splitter: RecursiveCharacterTextSplitter;
	private embeddingSemaphore: Semaphore;
	private ioSemaphore: Semaphore;
	private spinner: Ora | null = null;
	private totalFiles = 0;
	private processedFiles = 0;
	private enc = encodingForModel("gpt-3.5-turbo");

	constructor() {
		this.splitter = new RecursiveCharacterTextSplitter({
			chunkSize: 500,
			chunkOverlap: 50,
			lengthFunction: (text: string) => {
				return this.enc.encode(text).length;
			},
		});

		this.embeddingSemaphore = new Semaphore(3);
		this.ioSemaphore = new Semaphore(10);
	}

	public setSpinner(total: number) {
		this.totalFiles = total;
		this.processedFiles = 0;
		this.spinner = ora({
			text: `Initializing RAG indexing (0/${total})...`,
			stream: process.stderr,
		}).start();
	}

	private updateProgress(filePath: string) {
		this.processedFiles++;
		if (this.spinner) {
			this.spinner.text = `[${this.processedFiles}/${this.totalFiles}] Indexing: ${path.basename(filePath)}`;
		}
		if (this.processedFiles >= this.totalFiles && this.spinner) {
			this.spinner.succeed(`Successfully indexed ${this.totalFiles} files.`);
			this.spinner = null;
		}
	}

	private async buildFileRecords(
		filePath: string,
		content?: string,
	): Promise<{ records: VectorRecord[]; mtime: string }> {
		const fileStat = await fs.stat(filePath);
		const fileContent = content ?? (await fs.readFile(filePath, "utf-8"));
		const { frontmatter, content: body } = parseMatter(
			filePath,
			fileStat.birthtime.toISOString(),
			fileContent,
		);
		const fileName = path.basename(filePath);

		const headings = extractHeadingsWithPositions(body);
		const titleFromBody = headings.find((h) => h.depth === 1)?.heading ?? null;
		const docTitle = frontmatter.title || titleFromBody || fileName;
		const docStructure = headings
			.filter((h) => h.depth <= 2)
			.slice(0, 4)
			.map((h) => h.heading.slice(0, 25));

		const metadataPrefix = [
			`Title: ${docTitle.slice(0, 50)}`,
			frontmatter.tags?.length
				? `Tags: ${frontmatter.tags.slice(0, 3).join(", ")}`
				: "",
			frontmatter.summary ? `Summary: ${frontmatter.summary.slice(0, 60)}` : "",
		]
			.filter(Boolean)
			.join("\n");

		const chunks = await this.splitter.splitText(body);
		const records: VectorRecord[] = [];

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

			const combined = [metadataPrefix, context, chunk]
				.filter(Boolean)
				.join("\n\n");

			const MAX_EMBED_TOKENS = 500;
			const combinedTokenCount = this.enc.encode(combined).length;
			const safeText =
				combinedTokenCount > MAX_EMBED_TOKENS
					? combined.slice(
							0,
							Math.floor(
								combined.length * (MAX_EMBED_TOKENS / combinedTokenCount),
							),
						)
					: combined;

			await this.embeddingSemaphore.acquire();
			let vector: number[];
			try {
				const isLocalReady = await localEmbedder.checkModelPresence();
				if (isLocalReady) {
					vector = await localEmbedder.embed(`search_document: ${safeText}`);
				} else {
					vector = await llmClient.generateEmbedding(
						`search_document: ${safeText}`,
					);
				}
			} finally {
				this.embeddingSemaphore.release();
			}

			records.push({
				id: `${filePath}_chunk_${i}`,
				filePath,
				fileName,
				chunkIndex: i,
				content: chunk,
				context,
				vector,
				metadata: {
					title: docTitle,
					date:
						frontmatter.date instanceof Date
							? frontmatter.date.toISOString()
							: frontmatter.date || fileStat.birthtime.toISOString(),
					tags: frontmatter.tags?.join(", ") ?? "",
					summary: frontmatter.summary || "",
					slug: frontmatter.slug || "",
					category: frontmatter.category || "any",
					completed: frontmatter.completed ?? false,
				},
			});
		}

		return { records, mtime: fileStat.mtime.toISOString() };
	}

	async processFile(filePath: string, content?: string): Promise<void> {
		try {
			const { records, mtime } = await this.buildFileRecords(filePath, content);
			if (records.length > 0) {
				await vectorDB.upsertChunks(records);
			}
			// 청크 생성 여부와 상관없이 파일 메타데이터(수정 시각)는 항상 업데이트
			await vectorDB.updateFileMeta(filePath, mtime);
		} catch (error) {
			console.error(`\nError processing file for RAG: ${filePath}`, error);
		} finally {
			this.updateProgress(filePath);
		}
	}

	async processFileInMemory(
		filePath: string,
		content?: string,
	): Promise<{ records: VectorRecord[]; mtime: string } | null> {
		try {
			return await this.buildFileRecords(filePath, content);
		} catch (error) {
			console.error(`\nError processing file for RAG: ${filePath}`, error);
			return null;
		} finally {
			this.updateProgress(filePath);
		}
	}

	async indexAll(vaultPath: string): Promise<void> {
		const walker = new DirectoryWalker();
		const filePaths = await walker.walk(vaultPath, this.ioSemaphore);
		const markdownFiles = filePaths.filter(
			(f) => f.endsWith(".md") || f.endsWith(".mdx"),
		);

		this.setSpinner(markdownFiles.length);

		const allRecords: VectorRecord[] = [];
		const allMeta: { filePath: string; mtime: string }[] = [];
		const fileSemaphore = new Semaphore(8);

		await Promise.all(
			markdownFiles.map(async (filePath) => {
				await fileSemaphore.acquire();
				try {
					const result = await this.processFileInMemory(filePath);
					if (result && result.records.length > 0) {
						allRecords.push(...result.records);
						allMeta.push({ filePath, mtime: result.mtime });
					}
				} finally {
					fileSemaphore.release();
				}
			}),
		);

		if (allRecords.length > 0) {
			await vectorDB.upsertChunks(allRecords);
			await vectorDB.updateFileMetaBatch(allMeta);
		}
	}

	async deleteFile(filePath: string): Promise<void> {
		await vectorDB.deleteByFilePath(filePath);
	}
}

export const ragIndexer = new RAGIndexer();
