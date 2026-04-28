import type { LLMHealthStatus } from "@cli/types.js";
import { Box, Text } from "ink";
import { useEffect } from "react";

interface LLMHealthCheckerProps {
	llmApi_URL: string;
	setLLMStatus: (status: LLMHealthStatus) => void;
	setErrorMessage: (message: string) => void;
}

export const LLMHealthChecker = ({
	llmApi_URL,
	setLLMStatus,
	setErrorMessage,
}: LLMHealthCheckerProps) => {
	useEffect(() => {
		async function checkLLMHealth() {
			try {
				const response = await fetch(`${llmApi_URL}/v1/models`);
				if (!response.ok) {
					setErrorMessage(
						`[CLI] LLM endpoint ${llmApi_URL} returned ${response.status}. Continuing anyway...`,
					);
				}
				setLLMStatus("success");
			} catch (_error) {
				setLLMStatus("error");
			}
		}

		checkLLMHealth();
	}, [llmApi_URL, setLLMStatus, setErrorMessage]);

	return (
		<Box>
			<Text color="yellow">App starting - verifying environment.</Text>
		</Box>
	);
};
