import { useState } from "react";
import { App } from "./App.js";
import { LLMErrorComponent } from "./ui/LLMErrorComponent.js";
import { LLMHealthChecker } from "./ui/LLMHealthChecker.js";
import type { LLMHealthStatus } from "./types.js";
import { KeypressProvider } from "./context/KeypressContext.js";

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
