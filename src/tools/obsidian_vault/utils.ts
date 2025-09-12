import { DocumentManager } from '../../utils/DocumentManager.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ObsidianContentQueryParams } from './params.js';

export async function searchDocuments(
  documentManager: DocumentManager,
  params: ObsidianContentQueryParams
): Promise<CallToolResult> {
  const response: CallToolResult = { content: [], isError: false };

  try {
    const searchResults = await documentManager.searchDocuments(params.keyword || '');
    const limitedResults = searchResults.slice(0, params.limit || 10);
    
    if (limitedResults.length === 0) {
      response.content.push({
        type: 'text',
        text: JSON.stringify({
          query: params.keyword,
          found: 0,
          message: `No documents found for keyword: "${params.keyword}"`,
          suggestion: "Try using different keywords or check your vault contents with 'list_all' action"
        }, null, 2)
      });
      return response;
    }

    const documentsData = limitedResults.map((doc) => {
      const baseDocument = {
        filename: doc.filePath.split('/').pop() || doc.filePath, // 파일명만 추출
        fullPath: doc.filePath,
        metadata: {
          title: doc.frontmatter.title || 'Untitled',
          tags: Array.isArray(doc.frontmatter.tags) ? doc.frontmatter.tags : [],
          category: doc.frontmatter.category || 'uncategorized',
          date: doc.frontmatter.date || null,
          summary: doc.frontmatter.summary || null,
          completed: doc.frontmatter.completed || false
        },
        stats: {
          contentLength: doc.contentLength,
          hasContent: doc.hasContent,
          wordCount: doc.content.split(/\s+/).length
        }
      };

      if (params.includeContent) {
        const contentLength = params.excerptLength || 1000;
        return {
          ...baseDocument,
          content: {
            full: doc.content,
            excerpt: doc.content.length > contentLength 
              ? doc.content.substring(0, contentLength) + '...'
              : doc.content
          }
        };
      } else {
        return {
          ...baseDocument,
          content: {
            preview: doc.content.substring(0, 200).replace(/\n/g, ' ').trim() + '...',
            note: 'Full content available with includeContent=true'
          }
        };
      }
    });

    response.content.push({
      type: 'text',
      text: JSON.stringify({
        query: params.keyword,
        found: limitedResults.length,
        total_in_vault: (await documentManager.getAllProcessedDocuments()).length,
        documents: documentsData,
        ai_instructions: {
          purpose: "Search results for analysis and summarization",
          usage: "Analyze these documents to answer user questions or provide insights",
          content_included: params.includeContent || false
        }
      }, null, 2)
    });

  } catch (error) {
    response.isError = true;
    response.content.push({
      type: 'text',
      text: JSON.stringify({
        error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        action: 'search',
        parameters: params
      }, null, 2)
    });
  }

  return response;
}

export async function readSpecificFile(
  documentManager: DocumentManager,
  params: ObsidianContentQueryParams
): Promise<CallToolResult> {
  const response: CallToolResult = { content: [], isError: false };

  try {
    const content = await documentManager.getDocumentContent(params.filename!);

    if (content === null) {
      response.content.push({
        type: 'text',
        text: JSON.stringify({
          error: `Document not found: ${params.filename}`,
          suggestion: "Use 'list_all' action to see available documents",
          searched_filename: params.filename
        }, null, 2)
      });
      return response;
    }

    // 캐시된 문서에서 메타데이터 가져오기
    const allDocs = await documentManager.getAllProcessedDocuments();
    const docMetadata = allDocs.find(doc => 
      doc.filePath.includes(params.filename!) || 
      doc.filePath.endsWith(params.filename!)
    );

    const documentData = {
      filename: params.filename,
      content: content,
      metadata: docMetadata ? {
        fullPath: docMetadata.filePath,
        title: docMetadata.frontmatter.title || 'Untitled',
        tags: Array.isArray(docMetadata.frontmatter.tags) ? docMetadata.frontmatter.tags : [],
        category: docMetadata.frontmatter.category || 'uncategorized',
        date: docMetadata.frontmatter.date || null,
        summary: docMetadata.frontmatter.summary || null,
        completed: docMetadata.frontmatter.completed || false
      } : null,
      stats: {
        contentLength: content.length,
        wordCount: content.split(/\s+/).length,
        lineCount: content.split('\n').length
      },
      ai_instructions: {
        purpose: "Complete document content for analysis",
        usage: "This is the full content of the requested document. Analyze, summarize, or extract information as needed.",
        content_type: "markdown"
      }
    };

    response.content.push({
      type: 'text',
      text: JSON.stringify(documentData, null, 2)
    });

  } catch (error) {
    response.isError = true;
    response.content.push({
      type: 'text',
      text: JSON.stringify({
        error: `Failed to read document: ${error instanceof Error ? error.message : String(error)}`,
        action: 'read',
        filename: params.filename
      }, null, 2)
    });
  }

  return response;
}

export async function listAllDocuments(
  documentManager: DocumentManager, 
  params: ObsidianContentQueryParams
): Promise<CallToolResult> {
  const response: CallToolResult = { content: [], isError: false };
  
  try {
    const allDocuments = await documentManager.getAllProcessedDocuments();
    const limitedDocs = allDocuments.slice(0, params.limit || 50);
    
    if (allDocuments.length === 0) {
      response.content.push({
        type: 'text',
        text: JSON.stringify({
          message: "No documents found in vault",
          total: 0,
          vault_path: documentManager.getStats().vaultPath
        }, null, 2)
      });
      return response;
    }

    const documentsOverview = limitedDocs.map(doc => {
      const baseInfo = {
        filename: doc.filePath.split('/').pop() || doc.filePath,
        fullPath: doc.filePath,
        metadata: {
          title: doc.frontmatter.title || 'Untitled',
          tags: Array.isArray(doc.frontmatter.tags) ? doc.frontmatter.tags : [],
          category: doc.frontmatter.category || 'uncategorized',
          date: doc.frontmatter.date || null,
          completed: doc.frontmatter.completed || false
        },
        stats: {
          contentLength: doc.contentLength,
          wordCount: doc.content.split(/\s+/).length
        }
      };

      if (params.includeContent) {
        return {
          ...baseInfo,
          preview: doc.content.substring(0, 200).replace(/\n/g, ' ').trim() + '...'
        };
      }

      return baseInfo;
    });

    const categoryStats = limitedDocs.reduce((acc, doc) => {
      const category = doc.frontmatter.category || 'uncategorized';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    response.content.push({
      type: 'text',
      text: JSON.stringify({
        vault_overview: {
          total_documents: allDocuments.length,
          showing: limitedDocs.length,
          category_breakdown: categoryStats
        },
        documents: documentsOverview,
        ai_instructions: {
          purpose: "Vault overview for navigation and discovery",
          usage: "Use this to help users find specific documents or understand vault structure",
          note: "Use 'read' action with specific filename to get full content"
        }
      }, null, 2)
    });

  } catch (error) {
    response.isError = true;
    response.content.push({
      type: 'text',
      text: JSON.stringify({
        error: `Failed to list documents: ${error instanceof Error ? error.message : String(error)}`,
        action: 'list_all'
      }, null, 2)
    });
  }
  
  return response;
}

/**
 * Vault 통계 - 시스템 상태 정보
 */
export async function statsAllDocuments(documentManager: DocumentManager): Promise<CallToolResult> {
  const response: CallToolResult = { content: [], isError: false };

  try {
    const stats = documentManager.getStats();
    const allDocs = await documentManager.getAllProcessedDocuments();
    
    // 추가 통계 계산
    const categoryBreakdown = allDocs.reduce((acc, doc) => {
      const category = doc.frontmatter.category || 'uncategorized';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const completedTasks = allDocs.filter(doc => doc.frontmatter.completed === true).length;
    const totalWords = allDocs.reduce((sum, doc) => sum + doc.content.split(/\s+/).length, 0);

    const statsData = {
      vault_info: {
        path: stats.vaultPath,
        initialized: stats.isInitialized,
        total_documents: stats.count,
        total_size_mb: parseFloat((stats.totalBytes / 1024 / 1024).toFixed(2)),
        total_words: totalWords
      },
      content_breakdown: {
        by_category: categoryBreakdown,
        completed_tasks: completedTasks,
        average_document_size_kb: parseFloat((stats.totalBytes / stats.count / 1024).toFixed(2))
      },
      ai_instructions: {
        purpose: "Vault statistics for understanding scope and organization",
        usage: "Use this information to provide context about the user's knowledge base"
      }
    };

    response.content.push({
      type: 'text',
      text: JSON.stringify(statsData, null, 2)
    });

  } catch (error) {
    response.isError = true;
    response.content.push({
      type: 'text',
      text: JSON.stringify({
        error: `Failed to get stats: ${error instanceof Error ? error.message : String(error)}`,
        action: 'stats'
      }, null, 2)
    });
  }

  return response;
}
