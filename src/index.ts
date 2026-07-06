#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import chalk from "chalk";
import { getOptions, setLocalLLMEnvSetting } from "./config.js";
import createMcpServer from "./server.js";
import { ensureAppDataDirs } from "./utils/constants.js";
import { localEmbedder } from "./utils/Embedder.js";
import { localReranker } from "./utils/LocalReranker.js";
import { localModelManager } from "./utils/LocalModelManager.js";
import { ServerLifecycle } from "./utils/ServerLifecycle.js";
import { vaultWatcher } from "./utils/VaultWatcher.js";

async function main() {
	ensureAppDataDirs();
	if (process.argv.slice(2).some((arg) => arg === "setup")) {
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

	const lifecycle = new ServerLifecycle();
	const server = createMcpServer(lifecycle);
	const transport = new StdioServerTransport();

	lifecycle.registerCleanup("local-model-manager", () =>
		localModelManager.shutdown(),
	);
	lifecycle.registerCleanup("vault-watcher", () => vaultWatcher.stop());
	lifecycle.registerCleanup("mcp-server", () => server.close());

	let exiting = false;
	const shutdownAndExit = async (reason: string, exitCode = 0) => {
		if (exiting) {
			return;
		}
		exiting = true;
		console.error(chalk.yellow(`\n🛑 Shutting down MCP server (${reason})...`));
		await lifecycle.shutdown(reason);
		process.exit(exitCode);
	};

	process.once("SIGINT", () => void shutdownAndExit("SIGINT"));
	process.once("SIGTERM", () => void shutdownAndExit("SIGTERM"));
	process.once("SIGHUP", () => void shutdownAndExit("SIGHUP"));
	process.stdin.once("end", () => void shutdownAndExit("stdin-end"));
	process.stdin.once("close", () => void shutdownAndExit("stdin-close"));
	process.stdin.once("error", () => void shutdownAndExit("stdin-error", 1));
	transport.onclose = () => void shutdownAndExit("transport-close");

	try {
		await vaultWatcher.start(options.vaultPath, lifecycle);
	} catch (error) {
		console.error(chalk.red("[VaultWatcher] Failed to start indexing:"), error);
		await lifecycle.shutdown("startup-failure");
		process.exit(1);
	}

	try {
		await server.connect(transport);
	} catch (error) {
		console.error(chalk.red("Failed to start MCP server:"), error);
		await lifecycle.shutdown("connect-failure");
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
