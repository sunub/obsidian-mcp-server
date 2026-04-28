export type HistoryType = "user" | "assistant" | "error" | "info";

export interface HistoryItem {
	id: number;
	type: HistoryType;
	content: string;
	timestamp: number;
}

/** MCP 도구 호출 결과 (SDK의 CallToolResult 경량 재정의) */
export interface McpToolResult {
	isError?: boolean;
	content: Array<{ type: string; text?: string }>;
}

/** MCP callTool 함수 시그니처 */
export type CallToolFn = (
	name: string,
	args: Record<string, unknown>,
) => Promise<McpToolResult>;

/** MCP 클라이언트 연결 상태 */
export type McpConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "error";

export type StreamingState =
	| "idle"
	| "thinking"
	| "streaming"
	| "executing"
	| "error";
