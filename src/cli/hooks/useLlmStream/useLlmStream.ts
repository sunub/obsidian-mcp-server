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
import type { useHistoryManager } from "../useHistoryManager.js";
import { useStateAndRef } from "../useStateAndRef.js";
import { findLastSafeSplitPoint } from "./markdownUtils.js";

export interface LlmStreamState {
	pendingItem: PendingItem | null;
	streamingState: StreamingState;
	isLoading: boolean;
	error: Error | null;
	lastOutputTime: number;
	sendMessage: (
		text: string,
		ragContext?: string | null,
		overrideTools?: McpToolInfo[],
	) => Promise<void>;
	submitQuery: (
		query: string,
		options?: {
			overrideTools?: McpToolInfo[];
			ragContext?: string | null;
			timestamp?: number;
		},
	) => Promise<void>;
	abortCurrentStream: () => void;
	clearStreamingHistory: () => void;
}

export interface LLMStreamOptions {
	addItem: ReturnType<typeof useHistoryManager>["addItem"];
	callTool?: CallToolFn;
	availableTools: McpToolInfo[];
}

export const useLlmStream = ({
	addItem,
	callTool,
	availableTools,
}: LLMStreamOptions): LlmStreamState => {
	const [streamingState, setStreamingState] = useState<StreamingState>("idle");
	const [error, setError] = useState<Error | null>(null);
	const [lastOutputTime, setLastOutputTime] = useState<number>(Date.now());
	const [pendingItem, pendingItemRef, setPendingItem] =
		useStateAndRef<PendingItem | null>(null);
	const userMessageTimestampRef = useRef<number>(0);
	const isFirstChunkRef = useRef<boolean>(true);

	const conversationRef = useRef<ConversationMessage[]>([]);
	const abortControllerRef = useRef<AbortController | null>(null);
	const isLoading = useMemo(() => streamingState !== "idle", [streamingState]);
	const llmMessageBufferRef = useRef<string>("");

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

	const flushPendingText = useCallback(() => {
		if (pendingItemRef.current) {
			addItem({
				type: isFirstChunkRef.current ? "assistant" : "assistant_chunk",
				content: pendingItemRef.current.content,
				timestamp: userMessageTimestampRef.current,
			});
			isFirstChunkRef.current = false;
			setPendingItem(null);
			llmMessageBufferRef.current = "";
		}
	}, [addItem, pendingItemRef, setPendingItem]);

	const sendMessage = useCallback(
		async (
			rawText: string,
			ragContext?: string | null,
			overrideTools?: McpToolInfo[],
		) => {
			const text = stripAnsi(rawText).trim();
			setStreamingState("thinking");
			isFirstChunkRef.current = true;
			llmMessageBufferRef.current = "";
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

						setLastOutputTime(Date.now());
						if (event.type === "content") {
							contentAccum += event.chunk;
							const { thinking, main, isThinking } =
								parseThinkingContent(contentAccum);
							const display = progressLog ? `${progressLog}\n${main}` : main;
							llmMessageBufferRef.current += event.chunk;

							const splitPoint = findLastSafeSplitPoint(
								llmMessageBufferRef.current,
							);

							if (splitPoint === llmMessageBufferRef.current.length) {
								setPendingItem({
									type: "assistant",
									content: display,
									thinkingContent: thinking || undefined,
									isThinking,
									isComplete: false,
								});
							} else {
								const before = llmMessageBufferRef.current.substring(
									0,
									splitPoint,
								);
								const after = llmMessageBufferRef.current.substring(splitPoint);

								addItem({
									type: isFirstChunkRef.current
										? "assistant"
										: "assistant_chunk",
									content: before,
									timestamp: userMessageTimestampRef.current,
								});
								isFirstChunkRef.current = false;

								llmMessageBufferRef.current = after;
								setPendingItem({
									type: "assistant",
									content: after,
									thinkingContent: thinking || undefined,
									isThinking,
									isComplete: false,
								});
							}
						} else if (event.type === "tool_calls") {
							toolCallsReceived = event.calls;
						}
					}

					flushPendingText();

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

							progressLog += `✓ 완료\n`;
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

						setPendingItem(null);
						setStreamingState("idle");
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
				llmMessageBufferRef.current = "";
				isFirstChunkRef.current = true;
				setPendingItem(null);
			}
		},
		[callTool, availableTools, addItem, flushPendingText, setPendingItem],
	);

	const abortCurrentStream = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}
		setPendingItem(null);
		setStreamingState("idle");
		setError(null);
	}, [setPendingItem]);

	const clearStreamingHistory = useCallback(() => {
		conversationRef.current = [];
	}, []);

	const submitQuery = useCallback(
		async (
			query: string,
			options?: {
				overrideTools?: McpToolInfo[];
				ragContext?: string | null;
				timestamp?: number;
			},
		) => {
			const timestamp = options?.timestamp ?? Date.now();
			userMessageTimestampRef.current = timestamp;

			addItem({
				type: "user",
				content: query,
				timestamp,
			});

			llmMessageBufferRef.current = "";
			await sendMessage(query, options?.ragContext, options?.overrideTools);
		},
		[addItem, sendMessage],
	);

	return {
		pendingItem,
		streamingState,
		isLoading,
		error,
		sendMessage,
		submitQuery,
		abortCurrentStream,
		clearStreamingHistory,
		lastOutputTime,
	};
};
