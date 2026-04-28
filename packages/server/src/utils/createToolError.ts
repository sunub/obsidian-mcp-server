import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function createToolError(
	error: string,
	suggestion?: string,
): CallToolResult {
	const payload: { error: string; suggestion?: string } = { error };
	if (suggestion) {
		payload.suggestion = suggestion;
	}

	return {
		isError: true,
		content: [
			{
				type: "text",
				text: JSON.stringify(payload, null, 2),
			},
		],
	};
}
