import {
	MAX_AGENTIC_ITERATIONS,
	MAX_TOOL_RESULT_CHARS,
} from "@cli/hooks/useLlmStream/constants.js";
import { callLLMStreaming } from "@cli/hooks/useLlmStream/llmService.js";
import type {
	ConversationMessage,
	ToolCall,
} from "@cli/hooks/useLlmStream/types.js";
import {
	formatToolArguments,
	mcpToolsToOpenAI,
	parseThinkingContent,
	prepareInitialMessages,
	stripAnsi,
	truncateHistory,
} from "@cli/hooks/useLlmStream/utils.js";
import type { McpToolInfo } from "@cli/services/McpClientService.js";
import type { CallToolFn, PendingItem, StreamingState } from "@cli/types.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AppEvent,
	appEvents,
	TransientMessageType,
} from "@/cli/utils/events.js";
import state from "@/config.js";
import { debugLogger } from "@/shared/index.js";

export interface LlmStreamState {
	pendingItem: PendingItem | null;
	streamingState: StreamingState;
	isLoading: boolean;
	error: Error | null;
	sendMessage: (
		text: string,
		ragContext?: string | null,
		overrideTools?: McpToolInfo[],
	) => Promise<void>;
	abortCurrentStream: () => void;
	clearStreamingHistory: () => void;
}

export const useLlmStream = (
	callTool?: CallToolFn,
	availableTools: McpToolInfo[] = [],
): LlmStreamState => {
	const [pendingItem, setPendingItem] = useState<PendingItem | null>(null);
	const [streamingState, setStreamingState] = useState<StreamingState>("idle");
	const [error, setError] = useState<Error | null>(null);

	const conversationRef = useRef<ConversationMessage[]>([]);
	const abortControllerRef = useRef<AbortController | null>(null);
	const isLoading = useMemo(() => streamingState !== "idle", [streamingState]);

	useEffect(() => {
		async function bootCheck() {
			const base = state.llmApiUrl.replace(/\/$/, "");
			const endpoints = [`${base}/health`, `${base}/v1/models`];
			for (const url of endpoints) {
				try {
					const resp = await fetch(url, {
						signal: AbortSignal.timeout(3000),
					});
					if (resp.ok) {
						appEvents.emit(AppEvent.TransientMessage, {
							type: TransientMessageType.Hint,
							message: `LLM Server verified at ${state.llmApiUrl}`,
						});
						debugLogger.writeInfo(
							`[CLI] LLM Server verified at ${state.llmApiUrl}`,
						);
						return;
					}
				} catch {}
			}
			debugLogger.warn(
				`[CLI] Could not reach LLM Server at ${state.llmApiUrl}`,
			);
		}
		void bootCheck();
	}, []);

	const sendMessage = useCallback(
		async (
			rawText: string,
			ragContext?: string | null,
			overrideTools?: McpToolInfo[],
		) => {
			// ... (omitting for brevity in thought, but I will provide full implementation in tool call)
			const text = stripAnsi(rawText).trim();
			setStreamingState("thinking");
			setPendingItem({ type: "assistant", content: "", isComplete: false });
			setError(null);

			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}
			abortControllerRef.current = new AbortController();
			const signal = abortControllerRef.current.signal;

			try {
				const { messages: rawMessages, userMessage } = prepareInitialMessages(
					text,
					ragContext,
					conversationRef.current,
				);

				// 토큰 절약을 위해 히스토리 절사 적용 (최대 6000자)
				const messages = truncateHistory(rawMessages, 6000);

				conversationRef.current.push(userMessage);

				const toolsToUse = overrideTools ?? availableTools;
				const openAITools =
					callTool && toolsToUse.length > 0
						? mcpToolsToOpenAI(toolsToUse)
						: undefined;

				let progressLog = "";

				for (let iter = 0; iter < MAX_AGENTIC_ITERATIONS; iter++) {
					let contentAccum = "";
					let toolCallsReceived: ToolCall[] | null = null;
					let firstEventReceived = false;

					for await (const event of callLLMStreaming(
						messages,
						openAITools,
						true,
						signal,
					)) {
						if (!firstEventReceived) {
							setStreamingState("streaming");
							firstEventReceived = true;
						}

						if (event.type === "content") {
							contentAccum += event.chunk;
							const { thinking, main, isThinking } =
								parseThinkingContent(contentAccum);
							const display = progressLog ? `${progressLog}\n${main}` : main;
							setPendingItem({
								type: "assistant",
								content: display,
								thinkingContent: thinking || undefined,
								isThinking,
								isComplete: false,
							});
						} else if (event.type === "tool_calls") {
							toolCallsReceived = event.calls;
						}
					}

					if (toolCallsReceived && toolCallsReceived.length > 0 && callTool) {
						debugLogger.debug(
							`[LLM] iter=${iter} executing ${toolCallsReceived.length} tool(s)`,
						);
						setStreamingState("executing");

						messages.push({
							role: "assistant",
							content: contentAccum,
							tool_calls: toolCallsReceived,
						});

						for (const tc of toolCallsReceived) {
							const argSummary = formatToolArguments(tc.function.arguments);

							progressLog += `🔧 ${tc.function.name}(${argSummary})\n`;
							setPendingItem({
								type: "assistant",
								content: progressLog,
								isComplete: false,
							});

							const args = JSON.parse(tc.function.arguments);
							const result = await callTool(tc.function.name, args);
							const resultText = result.content
								.map((c) => c.text ?? "")
								.join("")
								.slice(0, MAX_TOOL_RESULT_CHARS);

							progressLog += `  ✓ 완료\n`;
							setPendingItem({
								type: "assistant",
								content: progressLog,
								isComplete: false,
							});

							messages.push({
								role: "tool",
								tool_call_id: tc.id,
								content: resultText,
							});
						}
					} else {
						const { main } = parseThinkingContent(contentAccum);
						const finalContent = main || contentAccum;
						conversationRef.current.push({
							role: "assistant",
							content: finalContent,
						});

						const display = progressLog
							? `${progressLog}\n${finalContent}`
							: finalContent;

						setPendingItem({
							type: "assistant",
							content: display,
							isComplete: true,
						});
						break;
					}

					if (iter === MAX_AGENTIC_ITERATIONS - 1) {
						const fallback =
							"최대 도구 호출 횟수에 도달했습니다. 작업이 완료되지 않았을 수 있습니다.";
						conversationRef.current.push({
							role: "assistant",
							content: fallback,
						});
						setPendingItem({
							type: "assistant",
							content: progressLog ? `${progressLog}\n${fallback}` : fallback,
							isComplete: true,
						});
					}
				}
			} catch (err: unknown) {
				debugLogger.error("Stream Error:", err);
				setStreamingState("error");
				const message = err instanceof Error ? err.message : String(err);
				setError(new Error(`LLM 통신 실패: ${message}`));
				conversationRef.current.pop();
				setPendingItem(null);
			}
		},
		[callTool, availableTools],
	);

	const abortCurrentStream = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}
		setPendingItem(null);
		setStreamingState("idle");
		setError(null);
	}, []);

	const clearStreamingHistory = useCallback(() => {
		conversationRef.current = [];
	}, []);

	return {
		pendingItem,
		streamingState,
		isLoading,
		error,
		sendMessage,
		abortCurrentStream,
		clearStreamingHistory,
	};
};
