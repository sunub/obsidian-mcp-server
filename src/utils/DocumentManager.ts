import { FileProcessor } from './processor/fileProcessor.js';
import { existsSync } from 'fs';
import { stat } from 'fs/promises';
import { join } from 'path';

import type { ProcessedDocument } from './processor/types.js';

export class DocumentManager {
  private fileProcessor: FileProcessor;
  private vaultPath: string;
  private isInitialized: boolean = false;

  constructor(vaultPath: string) {
    this.fileProcessor = new FileProcessor(50);
    this.vaultPath = vaultPath;
  }

  async initialize(): Promise<void> {
    if (!existsSync(this.vaultPath)) {
      throw new Error(`Vault 경로가 존재하지 않습니다: ${this.vaultPath}`);
    }

    await this.fileProcessor.processDirectory(this.vaultPath);
    this.isInitialized = true;
    
    const results = this.fileProcessor.getResults();
  }

  async getAllProcessedDocuments(): Promise<ProcessedDocument[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    return this.fileProcessor.getAllProcessedDocuments();
  }

  async getDocumentContent(filename: string): Promise<string | null> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const fullPath = join(this.vaultPath, filename);
    if (existsSync(fullPath)) {
      const stats = await stat(fullPath);
      if (stats.isFile()) {
        const result = await this.fileProcessor.processFile(fullPath);
        return result?.content || null;
      } else if (stats.isDirectory()) {
        const documents = await this.fileProcessor.processDirectory(fullPath);
        return documents.map(doc => `# ${doc.filePath}\n\n${doc.content}`).join('\n\n---\n\n');
      }
    }

    const document = this.fileProcessor.findDocumentByFilename(filename);
    return document?.content || null;
  }

  async getDocumentContentInfo(filename: string, options?: {
    includeStats?: boolean;
    includeBacklinks?: boolean;
    maxContentPreview?: number;
  }): Promise<ProcessedDocument | ProcessedDocument[] | null> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const defaultOptions = {
      includeStats: false,
      includeBacklinks: false,
      maxContentPreview: undefined,
      ...options
    };

    // 직접 파일 경로인 경우
    const fullPath = join(this.vaultPath, filename);
    if (existsSync(fullPath)) {
      const stats = await stat(fullPath);
      if (stats.isFile()) {
        const result = await this.fileProcessor.processFile(fullPath);
        if (result) {
          const processedDoc: ProcessedDocument = {
            filePath: fullPath,
            frontmatter: result.frontmatter,
            content: defaultOptions.maxContentPreview 
              ? result.content.substring(0, defaultOptions.maxContentPreview) 
              : result.content,
            contentLength: result.contentLength,
            hasContent: result.hasContent
          };

          // 통계 정보 추가
          if (defaultOptions.includeStats) {
            (processedDoc as any).stats = {
              wordCount: result.content.split(/\s+/).filter(word => word.length > 0).length,
              lineCount: result.content.split('\n').length,
              paragraphCount: result.content.split(/\n\s*\n/).filter(p => p.trim().length > 0).length,
              characterCount: result.content.length
            };
          }

          // 백링크 정보 추가
          if (defaultOptions.includeBacklinks) {
            const allDocs = this.fileProcessor.getAllProcessedDocuments();
            const backlinks = allDocs.filter(doc => 
              doc.content.includes(`[[${filename}]]`) || 
              doc.content.includes(`[[${filename.replace('.md', '')}]]`)
            ).map(doc => ({
              filePath: doc.filePath,
              title: doc.frontmatter?.title || doc.filePath.split('/').pop()?.replace('.md', '') || 'Untitled'
            }));
            (processedDoc as any).backlinks = backlinks;
          }

          return processedDoc;
        }
        return null;
      } else if (stats.isDirectory()) {
        // 디렉토리인 경우 모든 하위 문서 배열 반환
        const documents = await this.fileProcessor.processDirectory(fullPath);
        if (documents.length > 0) {
          return documents.map(doc => {
            const processedDoc: ProcessedDocument = { ...doc };
            
            if (defaultOptions.maxContentPreview) {
              processedDoc.content = doc.content.substring(0, defaultOptions.maxContentPreview);
            }

            if (defaultOptions.includeStats) {
              (processedDoc as any).stats = {
                wordCount: doc.content.split(/\s+/).filter(word => word.length > 0).length,
                lineCount: doc.content.split('\n').length,
                paragraphCount: doc.content.split(/\n\s*\n/).filter(p => p.trim().length > 0).length,
                characterCount: doc.content.length
              };
            }

            return processedDoc;
          });
        }
        return null;
      }
    }

    // 캐시된 문서에서 검색 (파일명만으로 검색)
    const document = this.fileProcessor.findDocumentByFilename(filename);
    if (document) {
      const processedDoc: ProcessedDocument = { ...document };
      
      if (defaultOptions.maxContentPreview) {
        processedDoc.content = document.content.substring(0, defaultOptions.maxContentPreview);
      }

      if (defaultOptions.includeStats) {
        (processedDoc as any).stats = {
          wordCount: document.content.split(/\s+/).filter(word => word.length > 0).length,
          lineCount: document.content.split('\n').length,
          paragraphCount: document.content.split(/\n\s*\n/).filter(p => p.trim().length > 0).length,
          characterCount: document.content.length
        };
      }

      if (defaultOptions.includeBacklinks) {
        const allDocs = this.fileProcessor.getAllProcessedDocuments();
        const backlinks = allDocs.filter(doc => 
          doc.content.includes(`[[${filename}]]`) || 
          doc.content.includes(`[[${filename.replace('.md', '')}]]`)
        ).map(doc => ({
          filePath: doc.filePath,
          title: doc.frontmatter?.title || doc.filePath.split('/').pop()?.replace('.md', '') || 'Untitled'
        }));
        (processedDoc as any).backlinks = backlinks;
      }

      return processedDoc;
    }
    
    return null;
  }

  async getAllDocumentsAsContext(
    includeFullContent: boolean = false,
    maxContentLength: number = 1000
  ): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const allDocs = this.fileProcessor.getAllProcessedDocuments();
    
    if (!includeFullContent) {
      // 요약만 포함
      return allDocs.map(doc => 
        `# ${doc.filePath}\n${doc.content.substring(0, maxContentLength)}...`
      ).join('\n\n---\n\n');
    }
    
    return this.fileProcessor.getAllDocumentsContent();
  }

  async searchDocuments(keyword: string): Promise<ProcessedDocument[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return this.fileProcessor.searchDocuments(keyword);
  }

  async refresh(): Promise<void> {
    this.fileProcessor.clearProcessedData();
    await this.initialize();
  }

  // 새로운 유틸리티 메서드들
  async getDocumentWithRelatedInfo(filename: string): Promise<{
    document: ProcessedDocument | null;
    relatedDocs: ProcessedDocument[];
    tags: string[];
    links: string[];
  } | null> {
    const document = await this.getDocumentContentInfo(filename);
    if (!document || Array.isArray(document)) {
      return null;
    }

    const allDocs = this.fileProcessor.getAllProcessedDocuments();
    
    // 관련 문서 찾기 (공통 태그 기반)
    const documentTags = document.frontmatter?.tags || [];
    const relatedDocs = allDocs.filter(doc => {
      if (doc.filePath === document.filePath) return false;
      const docTags = doc.frontmatter?.tags || [];
      return documentTags.some(tag => docTags.includes(tag));
    }).slice(0, 5); // 최대 5개

    // 문서 내 링크 추출
    const linkRegex = /[[^]]+/g;
    const links: string[] = [];
    let match;
    while ((match = linkRegex.exec(document.content)) !== null) {
      links.push(match[1]);
    }

    // 고유 태그 목록
    const allTags = Array.from(new Set(documentTags));

    return {
      document,
      relatedDocs,
      tags: allTags,
      links: Array.from(new Set(links))
    };
  }

  async writeDocumentWithFrontmatter(
    filename: string,
    frontmatter: Record<string, any>,
    content?: string
  ): Promise<void> {
    const { writeFile, readFile } = await import('fs/promises');
    const matter = await import('gray-matter');

    if (!this.isInitialized) {
      await this.initialize();
    }

    // 1. Find the document to get the correct full path
    const document = this.fileProcessor.findDocumentByFilename(filename);
    const fullPath = document ? document.filePath : join(this.vaultPath, filename);

    let existingContent = content || '';
    let existingFrontmatter = {};

    // 2. If the file exists and no new content is provided, read it
    if (existsSync(fullPath) && content === undefined) {
      try {
        const existingFile = await readFile(fullPath, 'utf8');
        const parsed = matter.default(existingFile);
        existingContent = parsed.content;
        existingFrontmatter = parsed.data;
      } catch (error) {
        // In case of read error, proceed with empty content
        console.error(`Error reading existing file at ${fullPath}:`, error);
      }
    }

    // 3. Merge frontmatter (new properties overwrite old ones)
    const mergedFrontmatter = { ...existingFrontmatter, ...frontmatter };

    // 4. Stringify the result
    const newDocument = matter.default.stringify(existingContent, mergedFrontmatter);

    // 5. Write the file
    await writeFile(fullPath, newDocument, 'utf8');

    // 6. Refresh cache
    await this.refresh();
  }

  getStats() {
    return {
      ...this.fileProcessor.getResults(),
      isInitialized: this.isInitialized,
      vaultPath: this.vaultPath
    };
  }
}
