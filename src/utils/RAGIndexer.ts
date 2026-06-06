import fs from "node:fs/promises";
import path from "node:path";
import ora, { type Ora } from "ora";
import { DirectoryWalker } from "./DirectoryWalker.js";
import { localEmbedder } from "./Embedder.js";
import { Semaphore } from "./semaphore.js";
import { type VectorRecord, vectorDB } from "./VectorDB.js";
import { WorkerPool } from "./worker/WorkerPool.js";

export type HeadingEntry = { heading: string; pos: number; depth: number };

export class RAGIndexer {
	private embeddingSemaphore: Semaphore;
	private ioSemaphore: Semaphore;
	private spinner: Ora | null = null;
	private totalFiles = 0;
	private processedFiles = 0;
	private _isIndexing = false;
	private chukingWorkerPool = new WorkerPool(4);

	constructor() {
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

	public getStatus() {
		return {
			isIndexing: this._isIndexing,
			processed: this.processedFiles,
			total: this.totalFiles,
			progress:
				this.totalFiles > 0
					? Math.round((this.processedFiles / this.totalFiles) * 100)
					: 0,
		};
	}

	public startIndexing(total: number) {
		this._isIndexing = true;
		this.totalFiles = total;
		this.processedFiles = 0;
	}

	public stopIndexing() {
		this._isIndexing = false;
	}

	private async buildFileRecords(
		filePath: string,
		content?: string,
	): Promise<{ records: VectorRecord[]; mtime: string }> {
		const fileStat = await fs.stat(filePath);
		const fileContent = content ?? (await fs.readFile(filePath, "utf-8"));
		const chunkMetadatas = await this.chukingWorkerPool.runTask({
			filePath,
			fileContent,
			birthTime: fileStat.birthtime.toISOString(),
		});

		await localEmbedder.init();
		const records: VectorRecord[] = [];

		for (const metadata of chunkMetadatas) {
			const combined = [
				metadata.context ? metadata.context : "",
				metadata.content,
			]
				.filter(Boolean)
				.join("\n\n");

			const MAX_EMBED_TOKENS = 500;
			const combinedTokenCount = localEmbedder.getTokenCount(combined);
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
				vector = await localEmbedder.embed(`search_document: ${safeText}`);
			} finally {
				this.embeddingSemaphore.release();
			}

			records.push({
				...metadata,
				vector,
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
		this._isIndexing = true;
		this.chukingWorkerPool.init();

		try {
			const walker = new DirectoryWalker();
			const filePaths = await walker.walk(vaultPath, this.ioSemaphore);
			const markdownFiles = filePaths.filter(
				(f) => f.endsWith(".md") || f.endsWith(".mdx"),
			);

			this.setSpinner(markdownFiles.length);

			const BATCH_SIZE = 50; // 50개 파일마다 DB에 기록하고 메모리 비움
			let currentBatch: VectorRecord[] = [];
			let currentMeta: { filePath: string; mtime: string }[] = [];
			const fileSemaphore = new Semaphore(8);

			for (let i = 0; i < markdownFiles.length; i += BATCH_SIZE) {
				const batchFiles = markdownFiles.slice(i, i + BATCH_SIZE);

				await Promise.all(
					batchFiles.map(async (filePath) => {
						await fileSemaphore.acquire();
						try {
							const result = await this.processFileInMemory(filePath);
							if (result && result.records.length > 0) {
								currentBatch.push(...result.records);
								currentMeta.push({ filePath, mtime: result.mtime });
							}
						} finally {
							fileSemaphore.release();
						}
					}),
				);

				// 현재 배치를 DB에 기록하고 메모리 해제
				if (currentBatch.length > 0) {
					await vectorDB.upsertChunks(currentBatch);
					await vectorDB.updateFileMetaBatch(currentMeta);
					// 배열 초기화로 가비지 컬렉션 유도
					currentBatch = [];
					currentMeta = [];
				}
			}
		} finally {
			this._isIndexing = false;
			this.chukingWorkerPool.terminateAll();
		}
	}

	async deleteFile(filePath: string): Promise<void> {
		await vectorDB.deleteByFilePath(filePath);
	}
}

export const ragIndexer = new RAGIndexer();
