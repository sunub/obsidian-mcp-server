import { join, extname } from 'path';
import { readdir } from 'fs/promises';


export class DirectoryWalker {
  private readonly allowedExtensions: string[];

  constructor(allowedExtensions: string[] = ['.md', '.mdx']) {
    this.allowedExtensions = allowedExtensions;
  }

  public async walk(dirPath: string): Promise<string[]> {
    const filePaths: string[] = [];
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const tasks = entries.map(async (entry) => {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          // 하위 디렉토리 재귀 탐색
          return this.walk(fullPath);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (this.allowedExtensions.includes(ext)) {
            return [fullPath];
          }
        }
        return [];
      });

      const results = await Promise.all(tasks);
      results.forEach((subPaths) => {
        if (subPaths) filePaths.push(...subPaths);
      });

    } catch (error) {
      console.error(`디렉토리 탐색 중 오류 발생: ${dirPath}`, error);
    }
    return filePaths;
  }
}
