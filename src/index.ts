#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import chalk from "chalk";
import { getOptions, setLocalLLMEnvSetting } from "./config.js";
import createMcpServer from "./server.js";
import { localEmbedder } from "./utils/Embedder.js";
import { localReranker } from "./utils/LocalReranker.js";
import { vaultWatcher } from "./utils/VaultWatcher.js";

async function main() {
	// 셋업 명령 확인
	if (process.argv[2] === "setup") {
		const { setup } = await import("./setup.js");
		const success = await setup({ force: true });
		process.exit(success ? 0 : 1);
	}

	const options = getOptions();
	if (!options) {
		console.error(
			chalk.red("올바르지 않은 설정으로 인해 서버를 시작할 수 없습니다."),
		);
		process.exit(1);
	}

	setLocalLLMEnvSetting();

	// 로컬 모델 상태 확인 및 출력
	const [embedderReady, rerankerReady] = await Promise.all([
		localEmbedder.checkModelPresence(),
		localReranker.checkModelPresence(),
	]);

	console.error(chalk.cyan.bold("\n🚀 Obsidian MCP Server Startup"));
	console.error(chalk.dim("----------------------------------"));
	console.error(
		`${chalk.bold("• Vault Path:")} ${chalk.blue(options.vaultPath)}`,
	);
	console.error(
		`${chalk.bold("• Local Embedder:")} ${embedderReady ? chalk.green("✅ Ready") : chalk.yellow("⚠️ Missing")}`,
	);
	console.error(
		`${chalk.bold("• Local Reranker:")} ${rerankerReady ? chalk.green("✅ Ready") : chalk.yellow("⚠️ Missing")}`,
	);

	if (embedderReady && rerankerReady) {
		console.error(
			chalk.green.bold("✔ High-performance Hybrid Search is ENABLED\n"),
		);
	} else {
		console.error(
			chalk.yellow(
				"ℹ Basic Keyword Search is active. Run 'npx @sunub/obsidian-mcp-server setup' to enable Hybrid Search.\n",
			),
		);
	}

	try {
		vaultWatcher.start(options.vaultPath).catch((error) => {
			console.error(
				chalk.red("[VaultWatcher] Background indexing error:"),
				error,
			);
		});

		const server = createMcpServer();
		const transport = new StdioServerTransport();
		await server.connect(transport);
	} catch (error) {
		console.error(chalk.red("Failed to start MCP server:"), error);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(
		chalk.red("main() 함수에서 치명적인 오류가 발생했습니다:"),
		error,
	);
	process.exit(1);
});
