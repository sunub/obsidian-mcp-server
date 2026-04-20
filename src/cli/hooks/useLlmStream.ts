import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { debugLogger } from "../utils/debugLogger.js";
import type { PendingItem, StreamingState, CallToolFn } from "../types.js";
import type { McpToolInfo } from "../services/McpClientService.js";
import state from "../../config.js";

const ANSI_RE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex:터미널 입력을 파싱하기 위한 정규식입니다.
	/[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[A-Za-z0-9=><~]/g;
function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

interface OpenAITool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters: Record<string, unknown>;
	};
}

interface ToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

type ConversationMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| { role: "assistant"; content: string; tool_calls?: ToolCall[] }
	| { role: "tool"; content: string; tool_call_id: string };

interface LLMResponse {
	content: string;
	finish_reason: string;
	tool_calls?: ToolCall[];
}

const MAX_AGENTIC_ITERATIONS = 10;
const MAX_TOOL_RESULT_CHARS = 8000;

function mcpToolsToOpenAI(tools: McpToolInfo[]): OpenAITool[] {
	return tools.map((t) => ({
		type: "function" as const,
		function: {
			name: t.name,
			description: t.description,
			parameters: (t.inputSchema as unknown as Record<string, unknown>) ?? {
				type: "object",
				properties: {},
			},
		},
	}));
}

async function callLLMNonStreaming(
	messages: ConversationMessage[],
	tools?: OpenAITool[],
): Promise<LLMResponse> {
	const url = `${state.llmApiUrl.replace(/\/$/, "")}/v1/chat/completions`;
	const body: Record<string, unknown> = {
		model: state.llmChatModel,
		messages,
		stream: false,
	};
	if (tools && tools.length > 0) {
		body["tools"] = tools;
		body["tool_choice"] = "auto";
	}

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`LLM API Error (${response.status}): ${errorText}`);
	}

	const json = (await response.json()) as {
		choices?: Array<{
			message?: { content?: string | null; tool_calls?: ToolCall[] };
			finish_reason?: string;
		}>;
	};
	const choice = json.choices?.[0];
	return {
		content: choice?.message?.content ?? "",
		finish_reason: choice?.finish_reason ?? "stop",
		tool_calls: choice?.message?.tool_calls,
	};
}

async function* generateLLMStream(messages: ConversationMessage[]) {
	const url = `${state.llmApiUrl.replace(/\/$/, "")}/v1/chat/completions`;

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: state.llmChatModel,
			messages,
			stream: true,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`LLM API Error (${response.status}): ${errorText}`);
	}

	const reader = response.body?.getReader();
	if (!reader) throw new Error("Response body is null");

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			const cleanedLine = line.replace(/^data: /, "").trim();
			if (!cleanedLine || cleanedLine === "[DONE]") continue;

			try {
				const parsed = JSON.parse(cleanedLine) as {
					choices?: Array<{
						delta?: { content?: string };
						finish_reason?: string;
					}>;
				};
				const content = parsed.choices?.[0]?.delta?.content;
				if (content) yield content;
			} catch (_e) {
			}
		}
	}
}

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
			const url = `${state.llmApiUrl.replace(/\/$/, "")}/v1/models`;
			try {
				const resp = await fetch(url);
				if (!resp.ok) throw new Error("API Check Failed");
				debugLogger.info(`[CLI] LLM Server verified at ${state.llmApiUrl}`);
			} catch (_err) {
				debugLogger.warn(
					`[CLI] Could not reach LLM Server at ${state.llmApiUrl}`,
				);
			}
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
				const messages: ConversationMessage[] = [];
				if (ragContext) {
					messages.push({ role: "system", content: ragContext });
				}
				messages.push(...conversationRef.current);

				const userMessage: ConversationMessage = {
					role: "user",
					content: text,
				};
				messages.push(userMessage);
				conversationRef.current.push(userMessage);

				const hasTools = Boolean(callTool) && availableTools.length > 0;

				if (hasTools && callTool) {
					const openAITools = mcpToolsToOpenAI(availableTools);
					let progressLog = "";
					let finalContent = "";

					for (let iter = 0; iter < MAX_AGENTIC_ITERATIONS; iter++) {
						const response = await callLLMNonStreaming(messages, openAITools);
						debugLogger.debug(
							`[LLM] iter=${iter} finish_reason=${response.finish_reason} tool_calls=${response.tool_calls?.length ?? 0}`,
						);

						const wantsTools =
							response.tool_calls != null && response.tool_calls.length > 0;

						if (wantsTools && response.tool_calls) {
							setStreamingState("streaming");

							messages.push({
								role: "assistant",
								content: response.content,
								tool_calls: response.tool_calls,
							});

							for (const tc of response.tool_calls) {
								let args: Record<string, unknown> = {};
								try {
									args = JSON.parse(tc.function.arguments) as Record<
										string,
										unknown
									>;
								} catch {
								}

								const argSummary = Object.entries(args)
									.map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 30)}`)
									.join(", ");

								progressLog += `🔧 ${tc.function.name}(${argSummary})\n`;
								setPendingItem({
									type: "assistant",
									content: progressLog,
									isComplete: false,
								});

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
							finalContent = response.content;
							break;
						}
					}

					if (!finalContent) {
						finalContent =
							"최대 도구 호출 횟수에 도달했습니다. 작업이 완료되지 않았을 수 있습니다.";
					}

					const displayContent = progressLog
						? `${progressLog}\n${finalContent}`
						: finalContent;

					conversationRef.current.push({
						role: "assistant",
						content: finalContent,
					});
					setStreamingState("streaming");
					setPendingItem({
						type: "assistant",
						content: displayContent,
						isComplete: true,
					});
				} else {
					const stream = generateLLMStream(messages);
					let isFirstChunk = true;
					let fullResponse = "";

					for await (const chunk of stream) {
						if (isFirstChunk) {
							setStreamingState("streaming");
							isFirstChunk = false;
						}
						fullResponse += chunk;
						setPendingItem((prev) =>
							prev ? { ...prev, content: prev.content + chunk } : null,
						);
					}

					conversationRef.current.push({
						role: "assistant",
						content: fullResponse,
					});
					setPendingItem((prev) =>
						prev ? { ...prev, isComplete: true } : null,
					);
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
