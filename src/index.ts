#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getOptions } from "./config.js";
import createMcpServer from "./server.js";

export default function smitheryEntryPoint() {
	const server = createMcpServer();
	return server.server;
}

async function main() {
	const options = getOptions();
	if (!options) {
		console.error("올바르지 않은 설정으로 인해 서버를 시작할 수 없습니다.");
		process.exit(1);
	}

	try {
		const server = createMcpServer();
		const transport = new StdioServerTransport();
		await server.connect(transport);
	} catch (error) {
		console.error("Failed to start MCP server:", error);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error("main() 함수에서 치명적인 오류가 발생했습니다:", error);
	process.exit(1);
});
