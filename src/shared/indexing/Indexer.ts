import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Semaphore } from "@shared/async/semaphore.js";
import * as LinkExtractor from "@shared/markdown/LinkExtractor.js";
import * as MatterParser from "@shared/markdown/MatterParser.js";
import type { DocumentIndex } from "@shared/markdown/types.js";
import { ChunkBM25Index } from "./keyword-search/index.js";

export interface KeywordSearchHit {
	document: DocumentIndex;
	score: number;
	chunk: string | null;
}

export class Indexer {
	private documentMap: Map<string, DocumentIndex> = new Map();
	private backlinkIndex: Map<string, Set<string>> = new Map();
	private keywordIndex = new ChunkBM25Index();

	public get totalFiles(): number {
		return this.documentMap.size;
	}

	private sourceToLinksMap: Map<string, string[]> = new Map();

	public async build(
		filePaths: string[],
		ioSemaphore: Semaphore,
	): Promise<void> {
		this.clear();
		const tasks = filePaths.map((filePath) =>
			this.processFile(filePath, ioSemaphore),
		);
		await Promise.all(tasks);
		// 전체 빌드 시에는 한 번만 호출
		this.rebuildBacklinkIndex();
	}

	public async upsertFile(
		filePath: string,
		ioSemaphore: Semaphore,
	): Promise<void> {
		this.removeFileEntries(filePath);
		await this.processFile(filePath, ioSemaphore);
		// 증분 업데이트
		const doc = this.documentMap.get(filePath);
		if (doc) {
			this.updateBacklinksForFile(filePath, doc.documentLinks);
		}
	}

	public removeFileEntries(filePath: string): void {
		const oldLinks = this.sourceToLinksMap.get(filePath) || [];
		for (const link of oldLinks) {
			const normalized = this.normalizeLink(link);
			const sources = this.backlinkIndex.get(normalized);
			if (sources) {
				sources.delete(filePath);
				if (sources.size === 0) {
					this.backlinkIndex.delete(normalized);
				}
			}
		}
		this.sourceToLinksMap.delete(filePath);

		this.keywordIndex.removeDocument(filePath);

		this.documentMap.delete(filePath);
	}

	public search(keyword: string): DocumentIndex[] {
		return this.searchWithChunks(keyword).map((hit) => hit.document);
	}

	public searchWithChunks(
		keyword: string,
		minRelativeScore = 0,
	): KeywordSearchHit[] {
		const hits = this.keywordIndex.search(keyword);
		const scoreFloor = (hits[0]?.score ?? 0) * minRelativeScore;
		return hits
			.filter((hit) => hit.score >= scoreFloor)
			.flatMap((hit) => {
				const document = this.documentMap.get(hit.filePath);
				return document
					? [{ document, score: hit.score, chunk: hit.chunk }]
					: [];
			});
	}

	public getDocument(filePath: string): DocumentIndex | null {
		return this.documentMap.get(filePath) || null;
	}

	public getAllDocuments(): DocumentIndex[] {
		return Array.from(this.documentMap.values());
	}

	public getBacklinks(filePath: string): string[] {
		const targetName = this.normalizeLink(
			join(filePath).split(/[/]/).pop() || "",
		);
		if (!targetName) {
			return [];
		}
		const backlinks = this.backlinkIndex.get(targetName);
		return backlinks ? Array.from(backlinks) : [];
	}

	public clear(): void {
		this.documentMap.clear();
		this.keywordIndex.clear();
		this.backlinkIndex.clear();
		this.sourceToLinksMap.clear();
	}

	private async processFile(
		filePath: string,
		ioSemaphore: Semaphore,
	): Promise<void> {
		await ioSemaphore.acquire();
		try {
			const fileContent = await readFile(filePath, "utf-8");
			const fileStat = await stat(filePath);
			const { frontmatter, content } = MatterParser.parse(
				filePath,
				fileStat.birthtime.toISOString(),
				fileContent,
			);

			const imageLinks = LinkExtractor.extractImageLinks(content);
			const documentLinks = LinkExtractor.extractDocumentLinks(content);

			const index: DocumentIndex = {
				filePath,
				frontmatter,
				contentLength: content.length,
				mtime: fileStat.mtime.getTime(),
				imageLinks,
				documentLinks,
			};

			this.documentMap.set(filePath, index);
			this.keywordIndex.addDocument({
				filePath,
				title: frontmatter.title ?? "",
				tags: frontmatter.tags ?? [],
				body: content,
			});
		} catch (error) {
			console.error(`파일 인덱싱 중 오류 발생: ${filePath}`, error);
		} finally {
			ioSemaphore.release();
		}
	}

	private updateBacklinksForFile(sourcePath: string, links: string[]): void {
		this.sourceToLinksMap.set(sourcePath, links);
		for (const targetLink of links) {
			const normalizedTarget = this.normalizeLink(targetLink);
			if (!this.backlinkIndex.has(normalizedTarget)) {
				this.backlinkIndex.set(normalizedTarget, new Set());
			}
			this.backlinkIndex.get(normalizedTarget)?.add(sourcePath);
		}
	}

	private rebuildBacklinkIndex(): void {
		this.backlinkIndex.clear();
		this.sourceToLinksMap.clear();
		for (const [sourcePath, sourceDoc] of this.documentMap.entries()) {
			this.updateBacklinksForFile(sourcePath, sourceDoc.documentLinks);
		}
	}

	private normalizeLink(link: string): string {
		return link.toLowerCase().replace(/\.mdx?$/, "");
	}
}
