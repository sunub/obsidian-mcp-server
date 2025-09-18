import { existsSync } from 'fs';
import { writeFile, readFile } from 'fs/promises';
import path, { basename, isAbsolute, join } from 'path';
import matter from 'gray-matter';

import { DirectoryWalker } from './DirectoryWalker.js';
import { Indexer } from './Indexer.js';
import type { DocumentIndex } from './processor/types.js';

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

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.walker = new DirectoryWalker(['.md', '.mdx']);
    this.indexer = new Indexer();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (!existsSync(this.vaultPath)) {
      throw new Error(`Vault 경로가 존재하지 않습니다: ${this.vaultPath}`);
    }
    const filePaths = await this.walker.walk(this.vaultPath);
    await this.indexer.build(filePaths);
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
    } = {}
  ): Promise<EnrichedDocument | null> {
    await this.initialize();
    let fullPath = this.parseFilenameToFullPath(filename);
    const index = this.indexer.getDocument(fullPath);
    if (!index) return null;

    const content = await this.getDocumentContent(fullPath);
    if (content === null) return null;

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

  public async writeDocument(fullPath: string, frontmatter: Record<string, any>): Promise<void> {
    const content = (await this.getDocumentContent(fullPath)) || '';
    const newDocument = matter.stringify(content, frontmatter);
    await writeFile(fullPath, newDocument, 'utf8');
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
    if (isAbsolute(filename) && existsSync(filename)) {
      return filename;
    }

    const exactPath = path.join(this.vaultPath, filename);
    if (existsSync(exactPath)) {
      return exactPath;
    }

    const candidates = [];
    if (/\.mdx?$/.test(filename)) {
      candidates.push(path.join(this.vaultPath, filename));
    } else {
      candidates.push(path.join(this.vaultPath, `${filename}.md`));
      candidates.push(path.join(this.vaultPath, `${filename}.mdx`));
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    const searchTerms = [
      filename.replace(/\.mdx?$/, ''),
      basename(filename, path.extname(filename)),
    ];

    for (const term of searchTerms) {
      const searchResults = this.indexer.search(term);
      const foundDoc = searchResults.find(
        (doc) => doc.filePath.includes(term)
      );
      if (foundDoc) {
        return foundDoc.filePath;
      }
    }
    return '';
  }

  private async getDocumentContent(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch (error) {
      console.error(`파일 내용을 읽는 중 오류 발생: ${filePath}`, error);
      return null;
    }
  }

  private addStats(doc: EnrichedDocument, content: string): void {
    doc.stats = {
      wordCount: content.split(/\s+/).filter(Boolean).length,
      lineCount: content.split('\n').length,
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
          join(path).split(/[\\/]/).pop()?.replace(/\.md$/, '') ||
          'Untitled',
      };
    });
  }
}
