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
import matter from "gray-matter";
import { throwIfAborted } from "../abort.js";
import { DirectoryWalker } from "../DirectoryWalker.js";
import { localEmbedder } from "../Embedder.js";
import { Indexer } from "../Indexer.js";
import { localModelManager } from "../LocalModelManager.js";
import { localReranker } from "../LocalReranker.js";
import type { DocumentIndex } from "../processor/types.js";
import { ragIndexer } from "../RAGIndexer.js";
import { Semaphore } from "../semaphore.js";
import { type ChunkMetadata, vectorDB } from "../VectorDB.js";
import type { EnrichedDocument } from "./types.js";
import { VaultPathError } from "./VaultPathError.js";

function isPathInside(basePath: string, candidatePath: string): boolean {
	const relativePath = relative(basePath, candidatePath);
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

const KEYWORD_FUSION_MIN_RELATIVE_SCORE = 0.7;

function toKeywordChunk(
	document: DocumentIndex,
	content: string,
): ChunkMetadata {
	const { frontmatter, filePath } = document;
	return {
		id: `${filePath}_keyword_chunk`,
		filePath,
		fileName: basename(filePath),
		chunkIndex: -1,
		content,
		metadata: {
			title: frontmatter.title,
			date:
				frontmatter.date instanceof Date
					? frontmatter.date.toISOString()
					: (frontmatter.date ?? ""),
			tags: frontmatter.tags?.join(", ") ?? "",
			summary: frontmatter.summary ?? "",
			slug: frontmatter.slug ?? "",
			category: frontmatter.category ?? "any",
			completed: frontmatter.completed ?? false,
		},
	};
}

function keywordChunksOf(
	document: DocumentIndex,
	chunk: string | null,
): ChunkMetadata[] {
	return chunk ? [toKeywordChunk(document, chunk)] : [];
}

export interface HybridSearchResult {
	score: number;
	document: DocumentIndex;
	matchedChunks: ChunkMetadata[];
	finalScore: number;
}

export class VaultManager {
	private vaultPath: string;
	private isInitialized: boolean = false;
	private initPromise: Promise<void> | null = null;
	private isLocalAIReady: boolean = false;
	private walker: DirectoryWalker;
	private indexer: Indexer;
	private ioSemaphore: Semaphore;
	private dbSemaphore: Semaphore;
	private hasNotifiedMissingModels = false;

	constructor(vaultPath: string, maxConcurrentIO: number = 10) {
		this.vaultPath = resolve(vaultPath);
		this.walker = new DirectoryWalker([".md", ".mdx"]);
		this.indexer = new Indexer();
		this.ioSemaphore = new Semaphore(maxConcurrentIO);
		this.dbSemaphore = new Semaphore(1);
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
			const [embedderReady, rerankerReady] = await Promise.all([
				localEmbedder.checkModelPresence(),
				localReranker.checkModelPresence(),
			]);
			this.isLocalAIReady = embedderReady && rerankerReady;
		} catch (error) {
			console.error("[VaultManager] AI 가용성 체크 중 오류:", error);
			this.isLocalAIReady = false;
		}
	}

	public async hybridSearch(
		query: string,
		limit: number = 5,
	): Promise<{ results: HybridSearchResult[]; diagnostic_message?: string }> {
		await this.initialize();

		if (!this.isLocalAIReady) {
			const keywordResults = this.indexer.searchWithChunks(query);
			let diagnostic_message: string | undefined;

			if (!this.hasNotifiedMissingModels) {
				diagnostic_message =
					"💡 [검색 품질 안내] 현재 로컬 모델이 설치되어 있지 않아 기본 키워드 검색으로 동작했습니다. 터미널에서 `npx @sunub/obsidian-mcp-server setup`을 실행하시면 고성능 하이브리드 검색을 사용할 수 있습니다.";
				this.hasNotifiedMissingModels = true;
			}

			const ragStatus = this.getRagIndexingStatus();
			if (ragStatus.isIndexing) {
				const indexingMsg = `⏳ [인덱싱 진행 중] 백그라운드에서 의미 기반 검색 인덱싱이 진행 중입니다 (${ragStatus.progress}% - ${ragStatus.processed}/${ragStatus.total}). 검색 결과가 일부 누락될 수 있습니다.`;
				diagnostic_message = diagnostic_message
					? `${diagnostic_message}\n\n${indexingMsg}`
					: indexingMsg;
			}

			return {
				results: keywordResults.slice(0, limit).map((hit) => ({
					score: 1.0,
					document: hit.document,
					matchedChunks: keywordChunksOf(hit.document, hit.chunk),
					finalScore: 1.0,
				})),
				diagnostic_message,
			};
		}

		const semanticResults = await this.safeSemanticSearch(query, limit * 3);
		const keywordResults = this.indexer.searchWithChunks(
			query,
			semanticResults.length > 0 ? KEYWORD_FUSION_MIN_RELATIVE_SCORE : 0,
		);
		const semanticFallbackMessage =
			semanticResults.length === 0
				? "💡 [검색 품질 안내] 로컬 semantic 모델이 아직 준비 중이거나 사용할 수 없어 이번 검색은 키워드 중심으로 반환했습니다. 잠시 후 다시 검색하면 하이브리드 검색이 적용될 수 있습니다."
				: undefined;

		const rrfScores = new Map<
			string,
			{
				score: number;
				document: DocumentIndex;
				matchedChunks: ChunkMetadata[];
				keywordChunks: ChunkMetadata[];
			}
		>();
		const RRF_K = 60;

		keywordResults.forEach((hit, index) => {
			rrfScores.set(hit.document.filePath, {
				score: 1 / (RRF_K + index + 1),
				document: hit.document,
				matchedChunks: [],
				keywordChunks: keywordChunksOf(hit.document, hit.chunk),
			});
		});

		const seenPaths = new Set<string>();
		let vectorRank = 0;
		for (const chunk of semanticResults) {
			if (!seenPaths.has(chunk.filePath)) {
				seenPaths.add(chunk.filePath);
				const vectorScore = 1 / (RRF_K + vectorRank + 1);

				const existing = rrfScores.get(chunk.filePath);
				if (existing) {
					existing.score += vectorScore;
					existing.matchedChunks.push(chunk);
				} else {
					const doc = this.indexer.getDocument(chunk.filePath);
					if (doc) {
						rrfScores.set(chunk.filePath, {
							score: vectorScore,
							document: doc,
							matchedChunks: [chunk],
							keywordChunks: [],
						});
					}
				}
				vectorRank++;
			} else {
				rrfScores.get(chunk.filePath)?.matchedChunks.push(chunk);
			}
		}

		const fusedResults = Array.from(rrfScores.values())
			.sort((a, b) => b.score - a.score)
			.slice(0, limit * 2);

		const finalResults: HybridSearchResult[] = fusedResults.map((f) => ({
			score: f.score,
			document: f.document,
			matchedChunks:
				f.matchedChunks.length > 0 ? f.matchedChunks : f.keywordChunks,
			finalScore: f.score,
		}));

		let diagnostic_message: string | undefined;
		const ragStatus = this.getRagIndexingStatus();
		if (ragStatus.isIndexing) {
			diagnostic_message = `⏳ [인덱싱 진행 중] 백그라운드에서 의미 기반 검색 인덱싱이 진행 중입니다 (${ragStatus.progress}% - ${ragStatus.processed}/${ragStatus.total}). 최근 변경된 파일은 검색 결과에 즉시 반영되지 않을 수 있습니다.`;
		}
		if (semanticFallbackMessage) {
			diagnostic_message = diagnostic_message
				? `${diagnostic_message}\n\n${semanticFallbackMessage}`
				: semanticFallbackMessage;
		}

		return {
			results: finalResults.slice(0, limit),
			diagnostic_message,
		};
	}

	private async safeSemanticSearch(
		query: string,
		limit: number,
	): Promise<ChunkMetadata[]> {
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

					// paraphrase-multilingual-MiniLM은 질의/문서 접두사(nomic 방식)를 학습하지 않았다.
					// 접두사를 붙이면 벡터 검색 Recall@5가 0.456에서 0.127로 떨어진다(docs/search-quality-evaluation.md).
					const queryVector = await localEmbedder.embed(query);

					const recallLimit = Math.max(limit * 3, 15);
					const initialResults = await vectorDB.search(
						queryVector,
						recallLimit,
					);

					// 청크 단계 리랭킹도 하지 않는다(위와 같은 평가 결과). 후보를 넉넉히 가져온 뒤
					// 벡터 순위 그대로 자른다.
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

		if (!this.isLocalAIReady || !localModelManager.isEmbedderReady) {
			return;
		}

		if (localModelManager.isEmbedderReady) {
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
		} else {
			console.error(
				`[VaultManager] Embedding server is down. Skipping RAG index for: ${filePath}`,
			);
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
