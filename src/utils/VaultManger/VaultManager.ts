import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { DirectoryWalker } from "../DirectoryWalker.js";
import { localEmbedder } from "../Embedder.js";
import { Indexer } from "../Indexer.js";
import { llmClient } from "../LLMClient.js";
import { localReranker } from "../LocalReranker.js";
import type { DocumentIndex } from "../processor/types.js";
import { ragIndexer } from "../RAGIndexer.js";
import { Semaphore } from "../semaphore.js";
import { type ChunkMetadata, vectorDB } from "../VectorDB.js";
import type { EnrichedDocument } from "./types.js";
import { VaultPathError } from "./VaultPathError.js";

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
  private hasNotifiedMissingModels = false;

  constructor(vaultPath: string, maxConcurrentIO: number = 10) {
    this.vaultPath = resolve(vaultPath);
    this.walker = new DirectoryWalker([".md", ".mdx"]);
    this.indexer = new Indexer();
    this.ioSemaphore = new Semaphore(maxConcurrentIO);
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

  /**
   * 키워드 검색과 벡터 검색을 병합하고 Reranker로 최적화하는 하이브리드 검색
   */
  public async hybridSearch(
    query: string,
    limit: number = 5,
  ): Promise<{ results: HybridSearchResult[]; diagnostic_message?: string }> {
    await this.initialize();

    // 1. AI 가용성 확인 및 Fallback 처리
    if (!this.isLocalAIReady) {
      const keywordResults = this.indexer.search(query);
      let diagnostic_message: string | undefined;

      if (!this.hasNotifiedMissingModels) {
        diagnostic_message =
          "💡 [검색 품질 안내] 현재 로컬 모델이 설치되어 있지 않아 기본 키워드 검색으로 동작했습니다. 터미널에서 `bunx obsidian-mcp-setup`을 실행하시면 고성능 하이브리드 검색을 사용할 수 있습니다.";
        this.hasNotifiedMissingModels = true;
      }

      // 인덱싱 상태 추가
      const ragStatus = this.getRagIndexingStatus();
      if (ragStatus.isIndexing) {
        const indexingMsg = `⏳ [인덱싱 진행 중] 백그라운드에서 의미 기반 검색 인덱싱이 진행 중입니다 (${ragStatus.progress}% - ${ragStatus.processed}/${ragStatus.total}). 검색 결과가 일부 누락될 수 있습니다.`;
        diagnostic_message = diagnostic_message
          ? `${diagnostic_message}\n\n${indexingMsg}`
          : indexingMsg;
      }

      return {
        results: keywordResults.slice(0, limit).map((doc) => ({
          score: 1.0,
          document: doc,
          matchedChunks: [],
          finalScore: 1.0,
        })),
        diagnostic_message,
      };
    }

    // 2. 병렬 검색 수행 (하이브리드)
    const [keywordResults, semanticResults] = await Promise.all([
      this.indexer.search(query),
      this.safeSemanticSearch(query, limit * 3),
    ]);

    // 3. RRF (Reciprocal Rank Fusion) 스코어 계산
    const rrfScores = new Map<
      string,
      { score: number; document: DocumentIndex; matchedChunks: ChunkMetadata[] }
    >();
    const RRF_K = 60;

    // 키워드 검색 결과 (문서 단위)
    keywordResults.forEach((doc, index) => {
      rrfScores.set(doc.filePath, {
        score: 1 / (RRF_K + index + 1),
        document: doc,
        matchedChunks: [],
      });
    });

    // 벡터 검색 결과 (청크 단위 -> 문서 단위로 병합)
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
            });
          }
        }
        vectorRank++;
      } else {
        // 이미 처리된 문서의 추가 청크들
        rrfScores.get(chunk.filePath)?.matchedChunks.push(chunk);
      }
    }

    // 4. 융합 결과 정렬
    const fusedResults = Array.from(rrfScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit * 2);

    // 5. Reranker 최적화
    let finalResults: HybridSearchResult[] = fusedResults.map((f) => ({
      ...f,
      finalScore: f.score,
    }));

    try {
      const rerankDocs = fusedResults.map((item) => {
        // 청크가 있으면 청크 내용, 없으면 요약이나 파일명 사용
        return (
          item.matchedChunks[0]?.content ||
          item.document.frontmatter.summary ||
          item.document.filePath
        );
      });

      const reranked = await localReranker.rerank(query, rerankDocs);
      finalResults = reranked
        .map((r) => {
          const original = fusedResults.find((f) => {
            const content =
              f.matchedChunks[0]?.content ||
              f.document.frontmatter.summary ||
              f.document.filePath;
            return content === r.document;
          });
          if (!original) return null;
          return { ...original, finalScore: r.score };
        })
        .filter((r): r is HybridSearchResult => r !== null);
    } catch (error) {
      console.error("[VaultManager] Reranking failed:", error);
    }

    // AI가 준비된 상태에서도 인덱싱이 진행 중이면 메시지 추가
    let diagnostic_message: string | undefined;
    const ragStatus = this.getRagIndexingStatus();
    if (ragStatus.isIndexing) {
      diagnostic_message = `⏳ [인덱싱 진행 중] 백그라운드에서 의미 기반 검색 인덱싱이 진행 중입니다 (${ragStatus.progress}% - ${ragStatus.processed}/${ragStatus.total}). 최근 변경된 파일은 검색 결과에 즉시 반영되지 않을 수 있습니다.`;
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
    try {
      const queryVector = await llmClient.generateEmbedding(
        `search_query: ${query}`,
      );
      return await vectorDB.search(queryVector, limit);
    } catch (_error) {
      return [];
    }
  }

  public async syncMissingRagIndices(): Promise<void> {
    // 로컬 모델이 있는 경우 우선적으로 사용
    if (this.isLocalAIReady) {
      await this.executeSync();
      return;
    }

    // 로컬 모델이 없는 경우 원격 서버 확인
    const isHealthy = await llmClient.isEmbeddingServerHealthy();
    if (isHealthy) {
      await this.executeSync();
    } else {
      // 아무것도 없으면 조용히 종료 (로그는 이미 index.ts에서 나옴)
      return;
    }
  }

  private async executeSync(): Promise<void> {
    const allDocs = await this.getAllDocuments();
    const forceReindex = await vectorDB.checkAndMigrateIfNeeded();
    const filesToProcess: string[] = [];

    for (const doc of allDocs) {
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
      try {
        for (const filePath of filesToProcess) {
          await ragIndexer.processFile(filePath);
        }
        await vectorDB.createVectorIndex();
      } finally {
        ragIndexer.stopIndexing();
      }
    }
  }

  public async upsertDocument(filePath: string): Promise<void> {
    await this.indexer.upsertFile(filePath, this.ioSemaphore);

    if (!this.isLocalAIReady) {
      return;
    }

    const isHealthy = await llmClient.isEmbeddingServerHealthy();
    if (isHealthy) {
      try {
        await ragIndexer.processFile(filePath);
      } catch (error) {
        console.error(
          `[VaultManager] Failed to process RAG index for ${filePath}:`,
          error,
        );
      }
    } else {
      console.error(
        `[VaultManager] Embedding server is down. Skipping RAG index for: ${filePath}`,
      );
    }
  }

  public async removeDocument(filePath: string): Promise<void> {
    this.indexer.removeFileEntries(filePath);
    await ragIndexer.deleteFile(filePath);
  }

  public async getAllDocuments(): Promise<DocumentIndex[]> {
    await this.initialize();
    return this.indexer.getAllDocuments();
  }

  public async searchDocuments(keyword: string): Promise<DocumentIndex[]> {
    await this.initialize();
    return this.indexer.search(keyword);
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
    const resolvedPath = this.resolvePathForWrite(fullPath);

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
    const resolvedPath = this.resolvePathForWrite(fullPath);

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
      if (this.isPathInsideVault(resolved) && existsSync(resolved)) {
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

    for (const term of searchTerms) {
      const searchResults = this.indexer.search(term);
      const foundDoc = searchResults.find((doc) => doc.filePath.includes(term));
      if (foundDoc) {
        return foundDoc.filePath;
      }
    }
    return "";
  }

  private resolvePathForWrite(inputPath: string): string {
    const resolvedPath = isAbsolute(inputPath)
      ? resolve(inputPath)
      : resolve(this.vaultPath, inputPath);

    if (!this.isPathInsideVault(resolvedPath)) {
      throw new VaultPathError(inputPath, resolvedPath, this.vaultPath);
    }

    return resolvedPath;
  }

  private isPathInsideVault(candidatePath: string): boolean {
    const relativePath = relative(this.vaultPath, candidatePath);
    return (
      relativePath === "" ||
      (!relativePath.startsWith("..") && !isAbsolute(relativePath))
    );
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
