import createMcpServer from './server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export default function smitheryEntryPoint() {
  const server = createMcpServer();
  return server.server;
}

async function main() {
  try {
    const server = createMcpServer();

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('main() 함수에서 치명적인 오류가 발생했습니다:', error);
  process.exit(1);
});
