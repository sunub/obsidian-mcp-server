import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import state from "../../../config.js";
import type { McpToolInfo } from "../../services/McpClientService.js";
import type { CallToolFn, PendingItem, StreamingState } from "../../types.js";
import { debugLogger } from "../../utils/debugLogger.js";
import { MAX_AGENTIC_ITERATIONS, MAX_TOOL_RESULT_CHARS } from "./constants.js";
import { callLLMStreaming } from "./llmService.js";
import type { ConversationMessage, ToolCall } from "./types.js";
import {
	formatToolArguments,
	mcpToolsToOpenAI,
	parseThinkingContent,
	prepareInitialMessages,
	stripAnsi,
} from "./utils.js";

export interface LlmStreamState {
	pendingItem: PendingItem | null;
	streamingState: StreamingState;
	isLoading: boolean;
	error: Error | null;
	sendMessage: (text: string, ragContext?: string | null) => Promise<void>;
	reset: () => void;
	clearHistory: () => void;
}

export const useLlmStream = (
	callTool?: CallToolFn,
	availableTools: McpToolInfo[] = [],
): LlmStreamState => {
	const [pendingItem, setPendingItem] = useState<PendingItem | null>(null);
	const [streamingState, setStreamingState] = useState<StreamingState>("idle");
	const [error, setError] = useState<Error | null>(null);

	const conversationRef = useRef<ConversationMessage[]>([]);
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
						debugLogger.info(`[CLI] LLM Server verified at ${state.llmApiUrl}`);
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
		async (rawText: string, ragContext?: string | null) => {
			const text = stripAnsi(rawText).trim();
			setStreamingState("thinking");
			setPendingItem({ type: "assistant", content: "", isComplete: false });
			setError(null);

			try {
				const { messages, userMessage } = prepareInitialMessages(
					text,
					ragContext,
					conversationRef.current,
				);
				conversationRef.current.push(userMessage);

				const openAITools =
					callTool && availableTools.length > 0
						? mcpToolsToOpenAI(availableTools)
						: undefined;

				let progressLog = "";

				for (let iter = 0; iter < MAX_AGENTIC_ITERATIONS; iter++) {
					let contentAccum = "";
					let toolCallsReceived: ToolCall[] | null = null;
					let firstEventReceived = false;

					for await (const event of callLLMStreaming(messages, openAITools)) {
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

	const reset = useCallback(() => {
		setPendingItem(null);
		setStreamingState("idle");
		setError(null);
	}, []);

	const clearHistory = useCallback(() => {
		conversationRef.current = [];
	}, []);

	return {
		pendingItem,
		streamingState,
		isLoading,
		error,
		sendMessage,
		reset,
		clearHistory,
	};
};
