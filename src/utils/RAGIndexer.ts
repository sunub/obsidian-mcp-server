import fs from "node:fs/promises";
import path from "node:path";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { DirectoryWalker } from "./DirectoryWalker.js";
import { ollamaClient } from "./OllamaClient.js";
import { parse as parseMatter } from "./processor/MatterParser.js";
import { Semaphore } from "./semaphore.js";
import { type VectorRecord, vectorDB } from "./VectorDB.js";

export class RAGIndexer {
	private splitter: RecursiveCharacterTextSplitter;
	private ollamaSemaphore: Semaphore;
	private ioSemaphore: Semaphore;

	constructor() {
		this.splitter = new RecursiveCharacterTextSplitter({
			chunkSize: 1000,
			chunkOverlap: 200,
		});
		// Ollama API 부하 조절 (동시 호출 제한)
		this.ollamaSemaphore = new Semaphore(3);
		// 파일 I/O 제한
		this.ioSemaphore = new Semaphore(10);
	}

	async processFile(filePath: string, content?: string): Promise<void> {
		try {
			const fileContent = content ?? (await fs.readFile(filePath, "utf-8"));
			const { frontmatter, content: body } = parseMatter(fileContent);
			const fileName = path.basename(filePath);

			// 문서 전체의 요약이나 핵심 정보를 Contextualization을 위한 힌트로 사용
			const docSummary = `Title: ${fileName}\nTags: ${frontmatter.tags?.join(", ") ?? ""}\nSummary: ${frontmatter.summary ?? ""}`;

			const chunks = await this.splitter.splitText(body);
			const records: VectorRecord[] = [];

			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];

				await this.ollamaSemaphore.acquire();
				try {
					// 1. Contextualize the chunk
					const context = await ollamaClient.generateContext(docSummary, chunk);

					// 2. Generate embedding for (Title + Tags + Context + Chunk)
					// Frontmatter는 body에서 strip되므로 title/tags를 명시적으로 포함하여
					// 제목 기반 검색에서도 매칭되도록 합니다.
					const metadataPrefix = [
						frontmatter.title ?? fileName,
						frontmatter.tags?.length ? `Tags: ${frontmatter.tags.join(", ")}` : "",
						frontmatter.summary ?? "",
					].filter(Boolean).join("\n");

					const textToEmbed = [
						metadataPrefix,
						context || "",
						chunk,
					].filter(Boolean).join("\n\n");

					const vector = await ollamaClient.generateEmbedding(textToEmbed);

					records.push({
						filePath,
						fileName,
						chunkIndex: i,
						content: chunk,
						context,
						vector,
					});
				} finally {
					this.ollamaSemaphore.release();
				}
			}

			if (records.length > 0) {
				await vectorDB.upsertChunks(records);
			}
		} catch (error) {
			console.error(`Error processing file for RAG: ${filePath}`, error);
		}
	}

	async indexAll(vaultPath: string): Promise<void> {
		const walker = new DirectoryWalker();
		const filePaths = await walker.walk(vaultPath, this.ioSemaphore);

		console.error(`Starting indexing for ${filePaths.length} files...`);

		// 순차적으로 또는 소규모 병렬로 처리하여 리소스 관리
		for (const filePath of filePaths) {
			await this.processFile(filePath);
		}

		console.error("Full indexing completed.");
	}

	async deleteFile(filePath: string): Promise<void> {
		await vectorDB.deleteByFilePath(filePath);
	}
}

export const ragIndexer = new RAGIndexer();
