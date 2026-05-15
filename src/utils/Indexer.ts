import { readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import * as LinkExtractor from "./processor/LinkExtractor.js";
import * as MatterParser from "./processor/MatterParser.js";
import type { DocumentIndex } from "./processor/types.js";
import type { Semaphore } from "./semaphore.js";

export class Indexer {
	private documentMap: Map<string, DocumentIndex> = new Map();
	private backlinkIndex: Map<string, Set<string>> = new Map();
	private invertedIndex: Map<string, Set<string>> = new Map();

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
		// 기존 링크 제거
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

		for (const [token, fileSet] of this.invertedIndex.entries()) {
			if (fileSet.has(filePath)) {
				fileSet.delete(filePath);
				if (fileSet.size === 0) {
					this.invertedIndex.delete(token);
				}
			}
		}

		this.documentMap.delete(filePath);
	}

	public search(keyword: string): DocumentIndex[] {
		const lowerKeyword = keyword.toLowerCase().trim();
		if (!lowerKeyword) {
			return [];
		}

		const tokens = lowerKeyword.split(/\s+/).filter((t) => t.length > 0);
		if (tokens.length === 0) {
			return [];
		}

		// 첫 번째 토큰의 매칭 결과를 기준 집합으로 잡고,
		// 나머지 토큰의 결과와 교집합(AND)을 구한다.
		const firstMatch = this.invertedIndex.get(tokens[0]);
		if (!firstMatch || firstMatch.size === 0) {
			return [];
		}

		let resultPaths = new Set(firstMatch);

		for (let i = 1; i < tokens.length; i++) {
			const tokenMatch = this.invertedIndex.get(tokens[i]);
			if (!tokenMatch || tokenMatch.size === 0) {
				return [];
			}
			resultPaths = new Set(
				[...resultPaths].filter((path) => tokenMatch.has(path)),
			);
			if (resultPaths.size === 0) {
				return [];
			}
		}

		return Array.from(resultPaths)
			.map((filePath) => this.documentMap.get(filePath))
			.filter(
				(documentIndex) => documentIndex !== undefined,
			) as DocumentIndex[];
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
		this.invertedIndex.clear();
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
			this.buildInvertedIndexForFile(index, content);
		} catch (error) {
			console.error(`파일 인덱싱 중 오류 발생: ${filePath}`, error);
		} finally {
			ioSemaphore.release();
		}
	}

	private buildInvertedIndexForFile(
		index: DocumentIndex,
		content: string,
	): void {
		const tokens = new Set<string>();

		const extension = extname(index.filePath);
		const fileBasename = basename(index.filePath, extension);
		tokens.add(fileBasename);

		if (index.frontmatter.title) {
			index.frontmatter.title
				.toLowerCase()
				.split(/\s+/)
				.forEach((t) => {
					t && tokens.add(t);
				});
		}
		if (index.frontmatter.tags) {
			index.frontmatter.tags.forEach((tag) => {
				tokens.add(tag.toLowerCase());
			});
		}

		content
			.toLowerCase()
			.match(/[a-z0-9가-힣]+/g)
			?.forEach((token) => {
				tokens.add(token);
			});

		const filename = index.filePath.split(/[/]/).pop() || "";
		if (filename) {
			tokens.add(filename.toLowerCase().replace(/\.mdx?$/, ""));
		}

		const headerRegex = /^#+\s+(.*)/gm;
		let match: RegExpExecArray | null = null;
		match = headerRegex.exec(content);
		while (match !== null) {
			if (match[1]) {
				tokens.add(match[1].toLowerCase().trim());
			}
			match = headerRegex.exec(content);
		}

		for (const token of tokens) {
			if (!this.invertedIndex.has(token)) {
				this.invertedIndex.set(token, new Set());
			}
			this.invertedIndex.get(token)?.add(index.filePath);
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
