import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path, { basename, isAbsolute, join, resolve } from "node:path";
import matter from "gray-matter";

import { DirectoryWalker } from "./DirectoryWalker.js";
import { Indexer } from "./Indexer.js";
import type { DocumentIndex } from "./processor/types.js";
import { Semaphore } from "./semaphore.js";

export interface EnrichedDocument extends DocumentIndex {
	content: string;
	stats?: {
		wordCount: number;
		lineCount: number;
		characterCount: number;
		contentLength: number;
		hasContent: boolean;
	};
	backlinks?: {
		filePath: string;
		title: string;
	}[];
}

export class VaultManager {
	private vaultPath: string;
	private isInitialized: boolean = false;
	private walker: DirectoryWalker;
	private indexer: Indexer;
	private ioSemaphore: Semaphore;

	constructor(vaultPath: string, maxConcurrentIO: number = 10) {
		this.vaultPath = vaultPath;
		this.walker = new DirectoryWalker([".md", ".mdx"]);
		this.indexer = new Indexer();
		this.ioSemaphore = new Semaphore(maxConcurrentIO);
	}

	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}
		if (!existsSync(this.vaultPath)) {
			throw new Error(`Vault 경로가 존재하지 않습니다: ${this.vaultPath}`);
		}
		const filePaths = await this.walker.walk(this.vaultPath, this.ioSemaphore);
		await this.indexer.build(filePaths, this.ioSemaphore);
		this.isInitialized = true;
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
		await this.ioSemaphore.acquire();
		try {
			const content = (await this.readDocumentContent(fullPath)) || "";
			const newDocument = matter.stringify(content, frontmatter);
			await writeFile(fullPath, newDocument, "utf8");
		} finally {
			this.ioSemaphore.release();
		}
		await this.refresh();
	}

	public async refresh(): Promise<void> {
		this.isInitialized = false;
		await this.initialize();
	}

	public getStats() {
		return {
			totalFiles: this.indexer.totalFiles,
			isInitialized: this.isInitialized,
			vaultPath: this.vaultPath,
		};
	}

	private parseFilenameToFullPath(filename: string): string {
		// 절대 경로인 경우, vault 경로 내부인지 검증
		if (isAbsolute(filename)) {
			const resolved = resolve(filename);
			if (resolved.startsWith(this.vaultPath) && existsSync(resolved)) {
				return resolved;
			}
			return "";
		}

		// 상대 경로를 resolve하고 Path Traversal 방어
		const exactPath = resolve(this.vaultPath, filename);
		if (!exactPath.startsWith(this.vaultPath)) {
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
			if (candidate.startsWith(this.vaultPath) && existsSync(candidate)) {
				return candidate;
			}
		}

		const searchTerms = [
			filename.replace(/\.mdx?$/, ""),
			basename(filename, path.extname(filename)),
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
