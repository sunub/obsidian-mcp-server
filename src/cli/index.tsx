import { render } from "ink";
import { AppContainer } from "./AppContainer.js";
import { debugLogger } from "./utils/debugLogger.js";
import "dotenv/config";

async function checkLLMHealth() {
  const apiUrl = (
    process.env.LLM_API_URL || "http://127.0.0.1:8080"
  ).replace(/\/$/, "");

  try {
    const response = await fetch(`${apiUrl}/v1/models`);
    if (!response.ok) {
      debugLogger.warn(
        `[CLI] LLM endpoint ${apiUrl} returned ${response.status}. Continuing anyway...`,
      );
      return;
    }
    debugLogger.log(`[CLI] Successfully verified LLM API at ${apiUrl}.`);
  } catch (_error) {
    debugLogger.warn(
      `[CLI] Could not connect to LLM API at ${apiUrl}. Make sure your server is running.`,
    );
  }
}

async function start() {
  debugLogger.log("App starting - verifying environment.");
  await checkLLMHealth();
  render(<AppContainer />);
}

start();
