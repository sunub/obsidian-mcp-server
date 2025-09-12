import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { DocumentManager } from "../utils/DocumentManager.js";
import { isIterable } from "../utils/isIterable.js";
import { getParsedVaultPath } from "../utils/parseVaultPath.js";

export async function registerLocalDocumentCallback(uri: URL, filename: string | string[]) {
  const vaultDirPath = getParsedVaultPath();
  if (!vaultDirPath) {
    throw new Error('VAULT_DIR_PATH environment variable is not set');
  }

  try {
    const documentManager = new DocumentManager(vaultDirPath);

    if (!filename) {
      const allContent = await documentManager.getAllProcessedDocuments();
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'text/plain',
            text: allContent,
          },
        ],
      };
    }
  
    if (typeof filename === 'object' && isIterable(filename)) {
      const promises = filename.map((name) => documentManager.getDocumentContent(name));
      const contents = await Promise.all(promises);
  
      const validContents = contents
        .map((content, index) => {
          if (content === null) return null;
          const currentFilename = filename[index];
          const currentUriTemplate = new UriTemplate('docs://{filename}');
          return {
            uri: currentUriTemplate.expand({ filename: currentFilename }),
            mimeType: 'text/plain',
            text: content,
          };
        })
        .filter((item) => item !== null);
  
      return {
        contents: validContents,
      };
    }
  
    const content = await documentManager.getDocumentContent(filename);
    if (content === null) {
      throw new Error('Document not found :' + filename);
    }
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/plain',
          text: content,
        },
      ],
    };
  } catch (error) {
    throw new Error(
      `Error Fethcing Document resource : ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
