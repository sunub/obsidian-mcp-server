import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { throwIfAborted } from "@shared/async/abort.js";
import { Semaphore } from "@shared/async/semaphore.js";
import { DirectoryWalker } from "@shared/indexing/DirectoryWalker.js";
import { Indexer } from "@shared/indexing/Indexer.js";
import { ragIndexer } from "@shared/indexing/RAGIndexer.js";
import { vectorDB } from "@shared/indexing/VectorDB.js";
import { localEmbedder } from "@shared/local-ai/Embedder.js";
import { localModelManager } from "@shared/local-ai/LocalModelManager.js";
import type { DocumentIndex } from "@shared/markdown/types.js";
import {
	EmbeddedSearchBackend,
	type HybridSearchResult,
} from "@shared/search-backend/index.js";
import type { SearchStatus } from "@shared/searchStatus.js";
import matter from "gray-matter";
import { lowConfidenceDenseThreshold } from "@/config.js";
import type { EnrichedDocument } from "./types.js";
import { VaultPathError } from "./VaultPathError.js";

function isPathInside(basePath: string, candidatePath: string): boolean {
	const relativePath = relative(basePath, candidatePath);
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

export type { HybridSearchResult };

export class VaultManager {
	private vaultPath: string;
	private isInitialized: boolean = false;
	private initPromise: Promise<void> | null = null;
	private isLocalAIReady: boolean = false;
	private walker: DirectoryWalker;
	private indexer: Indexer;
	private ioSemaphore: Semaphore;
	private dbSemaphore: Semaphore;
	private searchBackend: EmbeddedSearchBackend;

	constructor(vaultPath: string, maxConcurrentIO: number = 10) {
		this.vaultPath = resolve(vaultPath);
		this.walker = new DirectoryWalker([".md", ".mdx"]);
		this.indexer = new Indexer();
		this.ioSemaphore = new Semaphore(maxConcurrentIO);
		this.dbSemaphore = new Semaphore(1);
		this.searchBackend = new EmbeddedSearchBackend({
			indexer: this.indexer,
			isLocalAIReady: () => this.isLocalAIReady,
			semanticSearch: (query, limit) => this.safeSemanticSearch(query, limit),
			lowConfidenceThreshold: lowConfidenceDenseThreshold,
		});
	}

	async initialize(): Promise<void> {
		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = (async () => {
			if (!existsSync(this.vaultPath)) {
				throw new Error(`Vault 경로가 존재하지 않습니다: ${this.vaultPath}`);
			}

			await this.checkAIAvailability();

			const filePaths = await this.walker.walk(
				this.vaultPath,
				this.ioSemaphore,
			);
			await this.indexer.build(filePaths, this.ioSemaphore);
			this.isInitialized = true;
		})();

		return this.initPromise;
	}

	private async checkAIAvailability(): Promise<void> {
		try {
			this.isLocalAIReady = await localEmbedder.checkModelPresence();
		} catch (error) {
			console.error("[VaultManager] AI 가용성 체크 중 오류:", error);
			this.isLocalAIReady = false;
		}
	}

	public async hybridSearch(
		query: string,
		limit: number = 5,
	): Promise<{ results: HybridSearchResult[]; search_status: SearchStatus }> {
		await this.initialize();

		const { results, searchStatus } = await this.searchBackend.search(
			query,
			limit,
		);
		return { results, search_status: this.withIndexing(searchStatus) };
	}

	private withIndexing(status: SearchStatus): SearchStatus {
		const { isIndexing, progress, processed, total } =
			this.getRagIndexingStatus();
		return isIndexing
			? { ...status, indexing: { progress, processed, total } }
			: status;
	}

	private async safeSemanticSearch(
		query: string,
		limit: number,
	): ReturnType<typeof vectorDB.search> {
		if (!this.isLocalAIReady) {
			return [];
		}
		await this.dbSemaphore.acquire();
		try {
			return await localModelManager.withEmbedder(
				3000,
				async (isLocalReady) => {
					if (!isLocalReady) {
						return [];
					}

					const queryVector = await localEmbedder.embed(query);

					const recallLimit = Math.max(limit * 3, 15);
					const initialResults = await vectorDB.search(
						queryVector,
						recallLimit,
					);
					return initialResults.slice(0, limit);
				},
			);
		} catch (_error) {
			return [];
		} finally {
			this.dbSemaphore.release();
		}
	}

	public async syncMissingRagIndices(signal?: AbortSignal): Promise<void> {
		throwIfAborted(signal);
		// 로컬 모델이 있는 경우 우선적으로 사용
		if (this.isLocalAIReady) {
			await this.executeSync(signal);
			return;
		}
		const isLocalReady = await localEmbedder.checkModelPresence();
		if (isLocalReady) {
			await this.executeSync(signal);
		} else {
			// 아무것도 없으면 조용히 종료 (로그는 이미 index.ts에서 나옴)
			return;
		}
	}

	private async executeSync(signal?: AbortSignal): Promise<void> {
		throwIfAborted(signal);
		const allDocs = await this.getAllDocuments();
		const forceReindex = await vectorDB.checkAndMigrateIfNeeded();
		const filesToProcess: string[] = [];

		for (const doc of allDocs) {
			throwIfAborted(signal);
			if (forceReindex) {
				filesToProcess.push(doc.filePath);
			} else {
				const storedMtimeStr = await vectorDB.getFileMtime(doc.filePath);
				if (storedMtimeStr) {
					const storedTime = new Date(storedMtimeStr).getTime();
					if (Math.abs(storedTime - doc.mtime) > 1000) {
						filesToProcess.push(doc.filePath);
					}
				} else {
					filesToProcess.push(doc.filePath);
				}
			}
		}

		if (filesToProcess.length > 0) {
			console.error(
				`[VaultManager] Found ${filesToProcess.length} files to index for RAG.`,
			);
			ragIndexer.startIndexing(filesToProcess.length);
			ragIndexer.setSpinner(filesToProcess.length);
			await this.dbSemaphore.acquire();
			try {
				for (const filePath of filesToProcess) {
					throwIfAborted(signal);
					await ragIndexer.processFile(filePath, undefined, { signal });
				}
				await vectorDB.createVectorIndex();
			} finally {
				this.dbSemaphore.release();
				ragIndexer.stopIndexing();
			}
		}
	}

	public async upsertDocument(filePath: string): Promise<void> {
		await this.indexer.upsertFile(filePath, this.ioSemaphore);

		if (!this.isLocalAIReady) {
			return;
		}

		await this.dbSemaphore.acquire();
		try {
			await ragIndexer.processFile(filePath);
		} catch (error) {
			console.error(
				`[VaultManager] Failed to process RAG index for ${filePath}:`,
				error,
			);
		} finally {
			this.dbSemaphore.release();
		}
	}

	public async shutdown(): Promise<void> {
		await ragIndexer.shutdown();
	}

	public async removeDocument(filePath: string): Promise<void> {
		this.indexer.removeFileEntries(filePath);
		await this.dbSemaphore.acquire();
		try {
			await ragIndexer.deleteFile(filePath);
		} finally {
			this.dbSemaphore.release();
		}
	}

	public async getAllDocuments(): Promise<DocumentIndex[]> {
		await this.initialize();
		return this.indexer.getAllDocuments();
	}

	public async searchDocuments(keyword: string): Promise<DocumentIndex[]> {
		await this.initialize();
		return this.indexer.search(keyword);
	}

	private async waitUntilIndexed(
		fullPath: string,
		timeoutMs: number = 2000,
	): Promise<boolean> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			if (this.indexer.getDocument(fullPath)) {
				return true;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		return !!this.indexer.getDocument(fullPath);
	}

	public async getDocumentInfo(
		filename: string,
		options: {
			includeStats?: boolean;
			includeBacklinks?: boolean;
			maxContentPreview?: number;
			includeContentHash?: boolean;
		} = {},
	): Promise<EnrichedDocument | null> {
		await this.initialize();
		const fullPath = this.parseFilenameToFullPath(filename);
		if (!fullPath) {
			return null;
		}

		// 파일이 존재하지만 아직 인덱싱되지 않았을 수 있으므로 대기
		if (existsSync(fullPath)) {
			await this.waitUntilIndexed(fullPath);
		}

		const index = this.indexer.getDocument(fullPath);
		if (!index) {
			return null;
		}

		const content = await this.getDocumentContent(fullPath);
		if (content === null) {
			return null;
		}

		const enrichedDoc: EnrichedDocument = {
			...index,
			content: options.maxContentPreview
				? content.substring(0, options.maxContentPreview)
				: content,
		};

		if (options.includeContentHash) {
			enrichedDoc.contentHash = createHash("sha256")
				.update(content, "utf8")
				.digest("hex");
		}

		if (options.includeStats) {
			this.addStats(enrichedDoc, content);
		}

		if (options.includeBacklinks) {
			this.addBacklinks(enrichedDoc, fullPath);
		}

		return enrichedDoc;
	}

	public async writeDocument(
		fullPath: string,
		frontmatter: Record<string, unknown>,
	): Promise<void> {
		const resolvedPath = await this.resolvePathForWrite(fullPath);

		await this.ioSemaphore.acquire();
		try {
			const content = (await this.readDocumentContent(resolvedPath)) || "";
			const newDocument = matter.stringify(content, frontmatter);
			await writeFile(resolvedPath, newDocument, "utf8");
		} finally {
			this.ioSemaphore.release();
		}
		await this.upsertDocument(resolvedPath);
	}

	public async writeRawDocument(
		fullPath: string,
		content: string,
	): Promise<void> {
		const resolvedPath = await this.resolvePathForWrite(fullPath);

		await this.ioSemaphore.acquire();
		try {
			await mkdir(dirname(resolvedPath), { recursive: true });
			await writeFile(resolvedPath, content, "utf8");
		} finally {
			this.ioSemaphore.release();
		}

		await this.upsertDocument(resolvedPath);
	}

	public async refresh(): Promise<void> {
		this.isInitialized = false;
		await this.initialize();
		await this.syncMissingRagIndices();
	}

	public getStats() {
		return {
			totalFiles: this.indexer.totalFiles,
			isInitialized: this.isInitialized,
			vaultPath: this.vaultPath,
			ragStatus: this.getRagIndexingStatus(),
		};
	}

	public getRagIndexingStatus() {
		return ragIndexer.getStatus();
	}

	private parseFilenameToFullPath(filename: string): string {
		// 절대 경로인 경우, vault 경로 내부인지 검증
		if (isAbsolute(filename)) {
			const resolved = resolve(filename);
			if (this.isPathInsideVault(resolved)) {
				return resolved;
			}
			return "";
		}

		// 상대 경로를 resolve하고 Path Traversal 방어
		const exactPath = resolve(this.vaultPath, filename);
		if (!this.isPathInsideVault(exactPath)) {
			return "";
		}
		if (existsSync(exactPath)) {
			return exactPath;
		}

		const candidates = [];
		if (/\.mdx?$/.test(filename)) {
			candidates.push(resolve(this.vaultPath, filename));
		} else {
			candidates.push(resolve(this.vaultPath, `${filename}.md`));
			candidates.push(resolve(this.vaultPath, `${filename}.mdx`));
		}

		for (const candidate of candidates) {
			if (this.isPathInsideVault(candidate) && existsSync(candidate)) {
				return candidate;
			}
		}

		const searchTerms = [
			filename.replace(/\.mdx?$/, ""),
			basename(filename, extname(filename)),
		];

		const normalizeForMatch = (str: string) =>
			str.toLowerCase().replace(/[\s_-]/g, "");

		for (const term of searchTerms) {
			const normalizedTerm = normalizeForMatch(term);
			const searchResults = this.indexer.search(term);
			const foundDoc = searchResults.find((doc) => {
				const fileBase = basename(doc.filePath, extname(doc.filePath));
				return normalizeForMatch(fileBase) === normalizedTerm;
			});
			if (foundDoc) {
				return foundDoc.filePath;
			}
		}
		return "";
	}

	private async resolvePathForWrite(inputPath: string): Promise<string> {
		const resolvedPath = isAbsolute(inputPath)
			? resolve(inputPath)
			: resolve(this.vaultPath, inputPath);

		if (!this.isPathInsideVault(resolvedPath)) {
			throw new VaultPathError(inputPath, resolvedPath, this.vaultPath);
		}

		// 문자열 검사는 심볼릭 링크를 따라가지 않는다. 이미 존재하는 가장 깊은 상위 경로의
		// 실제 위치가 Vault 안인지 확인해, Vault 안의 링크를 거쳐 밖에 쓰는 경우를 막는다.
		const [realVault, realTarget] = await Promise.all([
			realpath(this.vaultPath),
			// 대상이 없는 링크(dangling)는 realpath가 실패하므로 쓰기를 거부한다
			realpath(this.deepestExistingPath(resolvedPath)).catch(() => null),
		]);
		if (realTarget === null || !isPathInside(realVault, realTarget)) {
			throw new VaultPathError(inputPath, resolvedPath, this.vaultPath);
		}

		return resolvedPath;
	}

	private deepestExistingPath(targetPath: string): string {
		const exists = (p: string) => {
			try {
				lstatSync(p); // 링크 자체의 존재를 본다
				return true;
			} catch {
				return false;
			}
		};
		let current = targetPath;
		while (!exists(current)) {
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}
		return current;
	}

	private isPathInsideVault(candidatePath: string): boolean {
		return isPathInside(this.vaultPath, candidatePath);
	}

	private async readDocumentContent(filePath: string): Promise<string | null> {
		try {
			return await readFile(filePath, "utf-8");
		} catch (error) {
			console.error(`파일 내용을 읽는 중 오류 발생: ${filePath}`, error);
			return null;
		}
	}

	private async getDocumentContent(filePath: string): Promise<string | null> {
		await this.ioSemaphore.acquire();
		try {
			return await readFile(filePath, "utf-8");
		} finally {
			this.ioSemaphore.release();
		}
	}

	private addStats(doc: EnrichedDocument, content: string): void {
		doc.stats = {
			wordCount: content.split(/\s+/).filter(Boolean).length,
			lineCount: content.split("\n").length,
			contentLength: content.length,
			hasContent: content.trim().length > 0,
			characterCount: content.length,
		};
	}

	private addBacklinks(doc: EnrichedDocument, fullPath: string): void {
		const backlinkPaths = this.indexer.getBacklinks(fullPath);
		doc.backlinks = backlinkPaths.map((path) => {
			const docIndex = this.indexer.getDocument(path);
			return {
				filePath: path,
				title:
					docIndex?.frontmatter?.title ||
					join(path).split(/[\\/]/).pop()?.replace(/\.md$/, "") ||
					"Untitled",
			};
		});
	}
}
