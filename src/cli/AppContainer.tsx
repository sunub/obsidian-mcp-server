import { App } from "@cli/App.js";
import { KeypressProvider } from "@cli/context/KeypressContext.js";
import type { LLMHealthStatus } from "@cli/types.js";
import { LLMErrorComponent } from "@cli/ui/LLMErrorComponent.js";
import { LLMHealthChecker } from "@cli/ui/LLMHealthChecker.js";
import { useState } from "react";

export const AppContainer = () => {
	const [llmStatus, setLLMStatus] = useState<LLMHealthStatus>("checking");
	const [errorMessage, setErrorMessage] = useState("");
	const llmApi_URL = (
		process.env["LLM_API_URL"] || "http://127.0.0.1:8080"
	).replace(/\/$/, "");

	if (llmStatus === "checking") {
		return (
			<LLMHealthChecker
				llmApi_URL={llmApi_URL}
				setLLMStatus={setLLMStatus}
				setErrorMessage={setErrorMessage}
			/>
		);
	}

	if (llmStatus === "error") {
		return (
			<LLMErrorComponent apiUrl={llmApi_URL} errorMessage={errorMessage} />
		);
	}

	return (
		<KeypressProvider>
			<App />
		</KeypressProvider>
	);
};
