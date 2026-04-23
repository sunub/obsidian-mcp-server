import chalk from "chalk";
import { render } from "ink";
import { AppContainer } from "./AppContainer.js";
import { debugLogger } from "./utils/debugLogger.js";
import "dotenv/config";

async function checkLLMHealth() {
	const apiUrl = (
		process.env["LLM_API_URL"] || "http://127.0.0.1:8080"
	).replace(/\/$/, "");

	try {
		const response = await fetch(`${apiUrl}/v1/models`);
		if (!response.ok) {
			debugLogger.warn(
				`[CLI] LLM endpoint ${apiUrl} returned ${response.status}. Continuing anyway...`,
			);
			return false;
		}
		debugLogger.info(`[CLI] Successfully verified LLM API at ${apiUrl}.`);
		return true;
	} catch (_error) {
		debugLogger.warn(
			`[CLI] Could not connect to LLM API at ${apiUrl}. Make sure your server is running.`,
		);
		const errorMessage =
			"[ERROR] LLM Server Connection Failed\n\nTo use semantic search and RAG features, a local LLM server (such as llama.cpp) must be running.\n\n[Action Required]\n1. Start your local LLM server.\n2. Ensure the environment variables (LLM_API_URL, LLM_EMBEDDING_API_URL) correctly match the running server's URL.\n3. Restart the service with the synchronized settings.";
		debugLogger.error(errorMessage);
		return false;
	}
}

async function start() {
	debugLogger.info("App starting - verifying environment.");
	const isHealthy = await checkLLMHealth();
	if (isHealthy) {
		const { waitUntilExit } = render(<AppContainer />);
		await waitUntilExit();

		debugLogger.log(chalk.yellow("\n[Notice] CLI Agent has exited."));
		debugLogger.log(
			chalk.gray(
				"If you have LLM or MCP servers running via PM2, you can manage them with:",
			),
		);
		debugLogger.log(chalk.cyan("  pm2 status          # Check process status"));
		debugLogger.log(chalk.cyan("  pm2 stop all        # Stop all processes"));

		debugLogger.info("App exited gracefully.");
	}
}

start();
