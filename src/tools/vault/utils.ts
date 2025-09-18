import { VaultManager, type EnrichedDocument } from '../../utils/VaultManager.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ObsidianContentQueryParams } from './params.js';
import type { DocumentIndex } from '../../utils/processor/types.js';
import { basename, extname, isAbsolute } from 'path';

async function getDocumentContent(
  vaultManager: VaultManager,
  filename: string,
  excerptLength?: number
): Promise<Partial<EnrichedDocument>> {
  const doc = await vaultManager.getDocumentInfo(filename, { includeStats: true });
  if (!doc) return {};

  if (excerptLength) {
    doc.content =
      doc.content.substring(0, excerptLength) + (doc.content.length > excerptLength ? '...' : '');
  }
  return doc;
}

function formatDocument(
  doc: DocumentIndex | EnrichedDocument,
  includeContent: boolean,
  excerptLength?: number
) {
  const hasContentProperty = 'content' in doc && typeof doc.content === 'string';

  // content 필드를 생성하는 로직을 명확하게 분리
  const createContentObject = () => {
    if (includeContent && hasContentProperty) {
      // FullContentSchema 형태
      const excerpt =
        excerptLength && doc.content!.length > excerptLength
          ? doc.content!.substring(0, excerptLength) + '...'
          : doc.content!;
      return {
        full: doc.content!,
        excerpt: excerpt,
      };
    } else {
      // PreviewContentSchema 형태
      return {
        preview: '(Content not loaded)',
        note: 'Full content available with includeContent=true',
      };
    }
  };
  console.log(doc);

  return {
    filename: doc.filePath.split('/').pop() || doc.filePath,
    fullPath: doc.filePath,
    metadata: {
      title: doc.frontmatter.title || 'Untitled',
      tags: doc.frontmatter.tags || [],
    },
    stats:
      'stats' in doc && doc.stats
        ? doc.stats
        : { contentLength: doc.contentLength, hasContent: hasContentProperty, wordCount: 0 },
    content: createContentObject(), // 항상 객체를 반환
  };
}

export async function searchDocuments(
  vaultManager: VaultManager,
  params: ObsidianContentQueryParams
): Promise<CallToolResult> {
  await vaultManager.initialize();
  const searchResults = await vaultManager.searchDocuments(params.keyword || '');

  if (params.quiet) {
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            found: searchResults.length,
            filenames: searchResults.map((doc) => doc.filePath.split('/').pop() || doc.filePath),
          }),
        },
      ],
    };
  }

  const documentsData = await Promise.all(
    searchResults.map(async (doc) => {
      if (params.includeContent) {
        const fullDoc = await getDocumentContent(vaultManager, doc.filePath, params.excerptLength);
        return formatDocument({ ...doc, ...fullDoc }, true, params.excerptLength);
      }
      return formatDocument(doc, false);
    })
  );

  return {
    isError: false,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            query: params.keyword,
            found: documentsData.length,
            total_in_vault: (await vaultManager.getAllDocuments()).length,
            documents: documentsData,
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function readSpecificFile(
  vaultManager: VaultManager,
  params: ObsidianContentQueryParams
): Promise<CallToolResult> {
  await vaultManager.initialize();

  const doc = await vaultManager.getDocumentInfo(params.filename ?? '', {
    includeStats: true,
    includeBacklinks: true,
  });

  if (!doc) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: `Document not found: ${params.filename}` }, null, 2),
        },
      ],
    };
  }

  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }],
  };
}

export async function listAllDocuments(
  vaultManager: VaultManager,
  params: ObsidianContentQueryParams
): Promise<CallToolResult> {
  await vaultManager.initialize();
  const allDocuments = await vaultManager.getAllDocuments();
  const limitedDocs = allDocuments.slice(0, params.limit || 50);

  if (params.quiet) {
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            total_documents: allDocuments.length,
            filenames: allDocuments.map((doc) => doc.filePath.split('/').pop() || doc.filePath),
          }),
        },
      ],
    };
  }

  const documentsOverview = await Promise.all(
    limitedDocs.map(async (doc) => {
      if (params.includeContent) {
        const fullDoc = await getDocumentContent(vaultManager, doc.filePath, 200);
        return formatDocument({ ...doc, ...fullDoc }, true, 200);
      }
      return formatDocument(doc, false);
    })
  );

  return {
    isError: false,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            vault_overview: {
              total_documents: allDocuments.length,
              showing: limitedDocs.length,
            },
            documents: documentsOverview,
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function statsAllDocuments(vaultManager: VaultManager): Promise<CallToolResult> {
  await vaultManager.initialize();
  const stats = vaultManager.getStats();
  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
  };
}
