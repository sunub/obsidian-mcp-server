#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ServerLifecycle } from "@shared/lifecycle/ServerLifecycle.js";
import { localEmbedder } from "@shared/local-ai/Embedder.js";
import { localModelManager } from "@shared/local-ai/LocalModelManager.js";
import { ensureAppDataDirs } from "@shared/paths/appData.js";
import { vaultWatcher } from "@shared/vault-manager/VaultWatcher.js";
import chalk from "chalk";
import {
	getOptions,
	type ObsidianMcpConfig,
	setLocalLLMEnvSetting,
} from "./config.js";
import createMcpServer from "./server.js";

function alertEmbedderState(
	options: ObsidianMcpConfig,
	embedderReady: boolean,
) {
	console.error(chalk.cyan.bold("\n🚀 Obsidian MCP Server Startup"));
	console.error(chalk.dim("----------------------------------"));
	console.error(
		`${chalk.bold("• Vault Path:")} ${chalk.blue(options.vaultPath)}`,
	);
	console.error(
		`${chalk.bold("• Local Embedder:")} ${embedderReady ? chalk.green("✅ Ready") : chalk.yellow("⚠️ Missing")}`,
	);

	if (embedderReady) {
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
}

async function main() {
	ensureAppDataDirs();
	const args = process.argv.slice(2);
	if (args.includes("setup")) {
		const { setup } = await import("./setup.js");
		const success = await setup({ force: true });
		process.exit(success ? 0 : 1);
	}

	if (args.includes("reindex")) {
		const options = getOptions();
		if (!options) {
			console.error(
				chalk.red("올바르지 않은 설정으로 인해 재색인을 시작할 수 없습니다."),
			);
			process.exit(1);
		}
		const force = args.includes("--force") || args.includes("-f");
		const { reindex } = await import("./reindex.js");
		const result = await reindex({ vaultPath: options.vaultPath, force });
		await localModelManager.shutdown();
		process.exit(result.success ? 0 : 1);
	}

	const options = getOptions();
	if (!options) {
		console.error(
			chalk.red("올바르지 않은 설정으로 인해 서버를 시작할 수 없습니다."),
		);
		process.exit(1);
	}

	setLocalLLMEnvSetting();

	const embedderReady = await localEmbedder.checkModelPresence();

	alertEmbedderState(options, embedderReady);

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
