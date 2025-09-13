import path from 'path';
import fs from 'fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ZodSchema } from 'zod';

import { listAllDocumentsResponseSchema } from '../src/tools/vault/types/list_all';
import { SearchSuccessSchema } from '../src/tools/vault/types/search';
import demo_data from './demo_data';

const TEST_VAULT_PATH = path.join(process.cwd(), 'test-vault');

async function parseAndValidateResponse<T extends ZodSchema>(response: any, schema: T): Promise<T['_output']> {
  expect(response.isError).toBe(false);
  const responseContent = response.content as { type: string; text: unknown }[];
  const responseText = JSON.parse(responseContent[0].text as string);
  const parsed = schema.safeParse(responseText);

  if (!parsed.success) {
    console.error(parsed.error.format());
    throw new Error('Response schema validation failed');
  }

  return parsed.data;
}

describe('Obsidian MCP Server E2E Tests', () => {
  let mcpClient: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    mcpClient = new Client({ name: 'test-client', version: '1.0.0' });
    transport = new StdioClientTransport({
      command: 'node',
      args: ['build/index.js'],
      env: { VAULT_DIR_PATH: TEST_VAULT_PATH },
    });
    await mcpClient.connect(transport);
  });

  afterAll(async () => {
    if (mcpClient) {
      await mcpClient.close();
    }
  });

  beforeEach(async () => {
    await fs.mkdir(TEST_VAULT_PATH, { recursive: true });
    for (const { title, tags, content } of demo_data) {
      const { text } = content;
      const frontmatter = `---\ntitle: ${title}\ntags: [${tags.join(', ')}]\n---\n\n`;
      const fileName = `${title.replace(/[/\\?%*:|"<>]/g, '-')}.md`;
      const filePath = path.join(TEST_VAULT_PATH, fileName);
      await fs.writeFile(filePath, frontmatter + text);
    }
  });

  afterEach(async () => {
    await fs.rm(TEST_VAULT_PATH, { recursive: true, force: true });
  });

  test('서버에 등록된 모든 도구 목록을 가져올 수 있다', async () => {
    const toolsResult = await mcpClient.listTools();
    const toolNames = toolsResult.tools.map((tool) => tool.name);
    
    const expectedTools = ['vault', 'create_document_with_properties', 'write_property', 'generate_property'];
    
    expect(toolNames).toEqual(expect.arrayContaining(expectedTools));
    expect(toolNames.length).toBe(expectedTools.length);
  });

  test('list_all 도구는 vault의 모든 문서 목록을 반환한다', async () => {
    const response = await mcpClient.callTool({
      name: 'vault',
      arguments: { action: 'list_all' },
    });

    const data = await parseAndValidateResponse(response, listAllDocumentsResponseSchema.shape.text);

    expect(data.vault_overview.total_documents).toBe(demo_data.length);
    expect(data.documents.length).toBe(demo_data.length);
    expect(data.ai_instructions.purpose).toBe('Vault overview for navigation and discovery');
    
    const sortedDocuments = [...data.documents].sort((a, b) => a.metadata.title.localeCompare(b.metadata.title));
    const sortedDemoData = [...demo_data].sort((a, b) => a.title.localeCompare(b.title));

    for (let i = 0; i < sortedDemoData.length; i++) {
      const demo = sortedDemoData[i];
      expect(sortedDocuments[i].metadata.title).toBe(demo.title);
      expect(sortedDocuments[i].metadata.tags).toEqual(demo.tags);
    }
  });

  test('search 도구는 "Test Note" 키워드로 정확한 문서를 찾는다', async () => {
    const response = await mcpClient.callTool({
      name: 'vault',
      arguments: {
        action: 'search',
        keyword: 'Test Note',
        includeContent: true,
      },
    });
    
    const data = await parseAndValidateResponse(response, SearchSuccessSchema);

    expect(data.query).toBe('Test Note');
    expect(data.found).toBe(1);
    expect(data.documents.length).toBe(1);
    
    const doc = data.documents[0];
    expect(doc.filename).toBe('Test Note.md');
    expect(doc.metadata.tags).toEqual(['test', 'initial']);
    expect('excerpt' in doc.content ? doc.content.excerpt : doc.content.preview).toBeDefined();
  });
});
