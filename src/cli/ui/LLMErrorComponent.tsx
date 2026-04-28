import { Box, Text } from "ink";
import { useEffect } from "react";

interface LLMErrorComponentProps {
	apiUrl: string;
	errorMessage: string;
}

export function LLMErrorComponent({
	apiUrl,
	errorMessage,
}: LLMErrorComponentProps) {
	const suggestions = [
		"[CLI] LLM Server Connection Failed",
		"To use semantic search and RAG features, a local LLM server (such as llama.cpp) must be running.",
		"[Action Required]",
		"1. Start your local LLM server.",
		"2. Ensure the environment variables (LLM_API_URL, LLM_EMBEDDING_API_URL) correctly match the running server's URL.",
		"3. Restart the service with the synchronized settings.",
	];

	useEffect(() => {
		process.exit(1);
	}, []);

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor="red"
		>
			<Box marginBottom={1}>
				<Text color="red" bold>
					{`[ERROR] Could not connect to LLM API at ${apiUrl}. Make sure your server is running.`}
				</Text>
			</Box>

			{suggestions.map((line) => (
				<Text color={"white"} key={`suggestion-${line}`}>
					{line}
				</Text>
			))}
			<Text>{`[Debug Info] ${errorMessage}`}</Text>
		</Box>
	);
}
