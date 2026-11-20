import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function toolJson(data: unknown): CallToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function toolError(message: string, hint?: string): CallToolResult {
	const text = hint ? `${message}\n${hint}` : message;
	return { isError: true, content: [{ type: "text", text }] };
}
