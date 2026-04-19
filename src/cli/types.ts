/**
 * Core types for the CLI AI Agent conversation system.
 *
 * These types define the data structures used to manage conversation state,
 * streaming responses, and history rendering throughout the application.
 */

/** 대화 기록의 단일 항목 */
export interface HistoryItem {
	/** 고유 식별자 (자동 증가) */
	id: number;
	/** 메시지 타입 */
	type: "user" | "assistant" | "error" | "info";
	/** 메시지 내용 (일반 텍스트, 향후 마크다운 렌더링 확장 가능) */
	content: string;
	/** 생성 시각 (Date.now()) */
	timestamp: number;
}

/**
 * 현재 스트리밍 중인 응답의 상태.
 *
 * `<Static>` 바깥에서 활발히 리렌더링되며,
 * `isComplete === true`가 되면 AppContainer가 history로 이관합니다.
 */
export interface PendingItem {
	type: "assistant";
	/** 실시간으로 누적되는 텍스트 */
	content: string;
	/** 스트림이 완료되었는지 */
	isComplete: boolean;
}

/**
 * LLM 스트리밍의 전체 상태 머신.
 *
 * - `idle`:      대기 상태 (입력 가능)
 * - `thinking`:  요청 전송 완료, 첫 번째 청크 대기 중
 * - `streaming`: 청크가 도착하여 실시간 출력 중
 * - `error`:     스트리밍 중 에러 발생
 */
export type StreamingState = "idle" | "thinking" | "streaming" | "error";

/**
 * 컨텐츠 렌더링 함수 시그니처.
 * 향후 마크다운 렌더링 지원 시 이 타입의 구현체를 교체하면 됩니다.
 */
export type ContentRenderer = (content: string, width: number) => string;

// ─── MCP Integration Types ─────────────────────────────────

/** Ollama 대화 메시지 (멀티턴 히스토리용) */
export interface OllamaMessage {
	role: "system" | "user" | "assistant";
	content: string;
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

/** Dispatcher 슬래시 커맨드 처리 결과 */
export interface DispatchResult {
	type: "tool_result" | "local_action" | "unknown_command";
	content: string;
}

/** MCP 클라이언트 연결 상태 */
export type McpConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "error";
