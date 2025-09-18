import { existsSync } from 'fs';
import { basename, dirname, join } from 'path';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';

import type { DocumentIndex } from '@/utils/processor/types.js';

type MoveSuccess = {
  status: 'moved';
  originalLink: string;
  newLink: string;
};

type MoveError = {
  status: 'error';
  imageName: string;
  reason: string;
};

type MoveResult = MoveSuccess | MoveError;

export function genreateOrganizationTasks(documents: DocumentIndex[], vaultDirPath: string) {
  return documents.map((doc) => async () => {
    const docTitle = doc.frontmatter?.title || basename(doc.filePath, '.md');
    const sanitizedTitle = docTitle.replace(/[\\?%*:|"<>]/g, '-');
    const imageLinks = doc.imageLinks || [];

    if (imageLinks.length === 0) {
      return {
        document: doc.filePath,
        status: 'skipped',
        message: 'No image links found.',
        movedFiles: [],
      };
    }

    const destinationFolder = 'images';
    const targetDir = join(destinationFolder, sanitizedTitle);
    const targetDirFullPath = join(vaultDirPath, targetDir);

    await mkdir(targetDirFullPath, { recursive: true });

    const docDir = dirname(doc.filePath);

    const movePromises = imageLinks.map(async (imageName): Promise<MoveResult> => {
      const originalImagePath = join(vaultDirPath, imageName);
      const originalImagePathInDocDir = join(docDir, imageName);

      let sourcePath: string;
      if (existsSync(originalImagePath)) {
        sourcePath = originalImagePath;
      } else if (existsSync(originalImagePathInDocDir)) {
        sourcePath = originalImagePathInDocDir;
      } else {
        return { imageName, status: 'error', reason: 'File not found' };
      }

      const newImageName = basename(imageName);
      const newImagePath = join(targetDirFullPath, newImageName);
      const newLinkPath = join(targetDir, newImageName).replace(/\\/g, '/');

      try {
        await rename(sourcePath, newImagePath);
        return {
          originalLink: `![[${imageName}]]`,
          newLink: `![[${newLinkPath}]]`,
          status: 'moved',
        };
      } catch (e) {
        return { imageName, status: 'error', reason: (e as Error).message };
      }
    });

    const moveResults = await Promise.all(movePromises);

    let content = await readFile(doc.filePath, 'utf-8');
    const successfullyMoved = moveResults.filter(
      (result): result is MoveSuccess => result.status === 'moved'
    );

    for (const result of successfullyMoved) {
      content = content.replace(result.originalLink, result.newLink);
    }

    await writeFile(doc.filePath, content, 'utf-8');

    return {
      document: doc.filePath,
      status: 'success',
      targetDirectory: targetDir,
      movedFiles: successfullyMoved.length,
      errors: moveResults.filter((r) => r.status === 'error'),
    };
  });
}
