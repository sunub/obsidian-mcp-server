import tools from './tools/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getParsedVaultPath } from './utils/parseVaultPath.js';
import pkg from '../package.json' with { type: 'json' };

export default function createMcpServer(): McpServer {
  const mcpServer = new McpServer(
    {
      version: pkg.version,
      name: 'obsidian-mcp-server',
      title: 'Obsidian MCP Server',
    },
    {
      capabilities: {
        logging: {},
        tools: { listChanged: false },
      },
      instructions: `
        This server provides access to Obsidian vault documents and related tools.
        
        Available tools:
        - obsidian_content_getter: Search, read, and analyze vault documents
        
        Available resources:
        - docs://{filename}: Read specific documents from the vault
        
        Environment requirements:
        - VAULT_DIR_PATH: Path to your Obsidian vault directory
      `,
    }
  );

  const vaultPath = getParsedVaultPath();
  if (!vaultPath) {
    console.error('⚠️  VAULT_DIR_PATH is not set. Document-related features will not work.');
  }
  
  for (const tool of Object.values(tools)) {
    tool.register(mcpServer);
  }

  return mcpServer;
}
