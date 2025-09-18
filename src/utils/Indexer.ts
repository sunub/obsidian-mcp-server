import { readFile } from 'fs/promises';
import { basename, extname, join } from 'path';
import { LinkExtractor } from './processor/LinkExtractor.js';
import { MatterParser } from './processor/MatterParser.js';
import type { DocumentIndex } from './processor/types.js';

export class Indexer {
  private documentMap: Map<string, DocumentIndex> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();
  private backlinkIndex: Map<string, Set<string>> = new Map();

  public get totalFiles(): number {
    return this.documentMap.size;
  }

  public async build(filePaths: string[]): Promise<void> {
    this.clear();
    const tasks = filePaths.map(filePath => this.processFile(filePath));
    await Promise.all(tasks);
    this.buildBacklinkIndex();
  }

  public search(keyword: string): DocumentIndex[] {
    const lowerKeyword = keyword.toLowerCase().trim();
    if (!lowerKeyword) return [];

    const matchingFilePaths = this.invertedIndex.get(lowerKeyword);
    if (!matchingFilePaths) return [];

    return Array.from(matchingFilePaths)
      .map((filePath) => this.documentMap.get(filePath)!)
      .filter(Boolean);
  }

  public getDocument(filePath: string): DocumentIndex | null {
    return this.documentMap.get(filePath) || null;
  }

  public getAllDocuments(): DocumentIndex[] {
    return Array.from(this.documentMap.values());
  }

  public getBacklinks(filePath: string): string[] {
    const targetName = this.normalizeLink(join(filePath).split(/[\/]/).pop() || '');
    if (!targetName) return [];
    const backlinks = this.backlinkIndex.get(targetName);
    return backlinks ? Array.from(backlinks) : [];
  }

  public clear(): void {
    this.documentMap.clear();
    this.invertedIndex.clear();
    this.backlinkIndex.clear();
  }

  private async processFile(filePath: string): Promise<void> {
    try {
      const fileContent = await readFile(filePath, 'utf-8');
      const { frontmatter, content } = MatterParser.parse(fileContent);
      
      const imageLinks = LinkExtractor.extractImageLinks(content);
      const documentLinks = LinkExtractor.extractDocumentLinks(content);

      const index: DocumentIndex = {
        filePath,
        frontmatter,
        contentLength: content.length,
        imageLinks,
        documentLinks,
      };

      this.documentMap.set(filePath, index);
      this.buildInvertedIndexForFile(index, content);
    } catch (error) {
      console.error(`파일 인덱싱 중 오류 발생: ${filePath}`, error);
    }
  }

  private buildInvertedIndexForFile(index: DocumentIndex, content: string): void {
    const tokens = new Set<string>();

    index.filePath.toLowerCase().split(/[\/\s\-\.]+/).forEach(t => t && tokens.add(t));
    const extension = extname(index.filePath);
    const fileBasename = basename(index.filePath, extension);
    tokens.add(fileBasename);

    if (index.frontmatter.title) {
      index.frontmatter.title.toLowerCase().split(/\s+/).forEach(t => t && tokens.add(t));
    }
    if (index.frontmatter.tags) {
      index.frontmatter.tags.forEach(tag => tokens.add(tag.toLowerCase()));
    }

    content.toLowerCase().match(/[a-z0-9가-힣]+/g)?.forEach(token => tokens.add(token));

     const filename = index.filePath.split(/[\/]/).pop() || '';
    if (filename) {
        tokens.add(filename.toLowerCase().replace(/\.mdx?$/, ''));
    }

    const headerRegex = /^#+\s+(.*)/gm;
    let match;
    while ((match = headerRegex.exec(content)) !== null) {
        if (match[1]) {
            tokens.add(match[1].toLowerCase().trim());
        }
    }

    for (const token of tokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(index.filePath);
    }
  }

  private buildBacklinkIndex(): void {
    this.backlinkIndex.clear();
    for (const [sourcePath, sourceDoc] of this.documentMap.entries()) {
      for (const targetLink of sourceDoc.documentLinks) {
        const normalizedTarget = this.normalizeLink(targetLink);
        if (!this.backlinkIndex.has(normalizedTarget)) {
          this.backlinkIndex.set(normalizedTarget, new Set());
        }
        this.backlinkIndex.get(normalizedTarget)!.add(sourcePath);
      }
    }
  }

  private normalizeLink(link: string): string {
    return link.toLowerCase().replace(/\.mdx?$/, '');
  }
}
