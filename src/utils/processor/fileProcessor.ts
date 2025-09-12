import { join, extname } from 'path';
import { createReadStream } from 'fs';
import { Semaphore } from '../semaphore.js';
import { readdir, stat } from 'fs/promises';
import { MatterTransform } from './matterTransform.js'
import { isMatterTransformData } from '../isMatterTransformData.js';

import type { MatterTransformData, ProcessedDocument } from './types.js'

export class FileProcessor {
  public count = 0;
  public totalBytes = 0;
  private semaphore: Semaphore;
  private processedFiles: MatterTransformData[] = [];
  private processedDocuments: ProcessedDocument[] = [];

  constructor(maxConcurrency: number = 50) {
    this.semaphore = new Semaphore(maxConcurrency);
  }

  async processFile(filePath: string): Promise<MatterTransformData | null> {
    await this.semaphore.acquire();

    try {
      const parser = new MatterTransform();
      const source = createReadStream(filePath, {
        highWaterMark: 8192,
      });

      const cleanup = () => {
        parser.removeAllListeners();
        source.removeAllListeners();

        if (!source.destroyed) {
          source.destroy();
        }

        if (!parser.destroyed) {
          parser.destroy();
        }
      };

      return new Promise<MatterTransformData | null>((resolve, reject) => {
        let processedData: MatterTransformData | null = null;

        parser.on('data', (data: MatterTransformData) => {
          if (isMatterTransformData(data)) {
            processedData = data;
          }
        });

        parser.on('end', () => {
          try {
            if (processedData) {
              this.count++;
              this.totalBytes += processedData.contentLength;
              this.processedFiles.push(processedData);
              
              // ProcessedDocument 형태로도 저장
              this.processedDocuments.push({
                filePath,
                frontmatter: processedData.frontmatter,
                content: processedData.content,
                contentLength: processedData.contentLength,
                hasContent: processedData.hasContent
              });
            }

            cleanup();
            resolve(processedData);
          } catch (error) {
            cleanup();
            reject(error as Error);
          }
        });

        parser.on('error', error => {
          cleanup();
          reject(error);
        });

        source.on('error', error => {
          cleanup();
          reject(error);
        });

        source.pipe(parser);
      });
    } catch (error) {
      console.error(`파일을 읽는 중 오류 발생: ${filePath}`, error);
      return null;
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * 디렉토리를 재귀적으로 탐색하여 모든 .md, .mdx 파일을 처리
   */
  async processDirectory(dirPath: string): Promise<ProcessedDocument[]> {
    const results: ProcessedDocument[] = [];
    
    try {
      const entries = await readdir(dirPath);
      
      for (const entry of entries) {
        const fullPath = join(dirPath, entry);
        const stats = await stat(fullPath);
        
        if (stats.isDirectory()) {
          // 재귀적으로 하위 디렉토리 처리
          const subResults = await this.processDirectory(fullPath);
          results.push(...subResults);
        } else if (stats.isFile()) {
          const ext = extname(entry).toLowerCase();
          if (ext === '.md' || ext === '.mdx') {
            const processedData = await this.processFile(fullPath);
            if (processedData) {
              results.push({
                filePath: fullPath,
                frontmatter: processedData.frontmatter,
                content: processedData.content,
                contentLength: processedData.contentLength,
                hasContent: processedData.hasContent
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`디렉토리 처리 중 오류 발생: ${dirPath}`, error);
    }
    
    return results;
  }

  /**
   * 특정 파일명으로 문서 검색
   */
  findDocumentByFilename(filename: string): ProcessedDocument | null {
    return this.processedDocuments.find(doc => 
      doc.filePath.includes(filename) || 
      doc.filePath.endsWith(filename)
    ) || null;
  }

  /**
   * 모든 문서의 내용을 하나의 텍스트로 결합
   */
  getAllDocumentsContent(): string {
    return this.processedDocuments
      .map(doc => `# ${doc.filePath}\n\n${doc.content}`)
      .join('\n\n---\n\n');
  }

  /**
   * 키워드로 문서 검색
   */
  searchDocuments(keyword: string): ProcessedDocument[] {
    const lowerKeyword = keyword.toLowerCase();
    return this.processedDocuments.filter(doc => 
      doc.content.toLowerCase().includes(lowerKeyword) ||
      doc.filePath.toLowerCase().includes(lowerKeyword) ||
      Object.values(doc.frontmatter).some(value => 
        typeof value === 'string' && value.toLowerCase().includes(lowerKeyword)
      )
    );
  }

  getResults() {
    return { count: this.count, totalBytes: this.totalBytes };
  }

  getAllProcessedData(): MatterTransformData[] {
    return this.processedFiles;
  }

  getAllProcessedDocuments(): ProcessedDocument[] {
    return this.processedDocuments;
  }

  clearProcessedData() {
    this.processedFiles = [];
    this.processedDocuments = [];
    this.count = 0;
    this.totalBytes = 0;
  }
}
