import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import state from "../../config.js";
import type { McpToolInfo } from "../services/McpClientService.js";
import type { CallToolFn, PendingItem, StreamingState } from "../types.js";
import { debugLogger } from "../utils/debugLogger.js";

let toolCallingSupportedCache: boolean | null = null;

const THINK_START = ["[Start thinking]", "<think>"];
const THINK_END = ["[End thinking]", "</think>"];

function parseThinkingContent(raw: string): {
	thinking: string;
	main: string;
	isThinking: boolean;
} {
	let thinking = "";
	let main = "";
	let remaining = raw;
	let inThinking = false;

	while (remaining.length > 0) {
		if (!inThinking) {
			let earliest = remaining.length;
			let markerLen = 0;
			for (const marker of THINK_START) {
				const idx = remaining.indexOf(marker);
				if (idx >= 0 && idx < earliest) {
					earliest = idx;
					markerLen = marker.length;
				}
			}
			main += remaining.slice(0, earliest);
			if (earliest === remaining.length) break;
			remaining = remaining.slice(earliest + markerLen);
			inThinking = true;
		} else {
			let earliest = remaining.length;
			let markerLen = 0;
			for (const marker of THINK_END) {
				const idx = remaining.indexOf(marker);
				if (idx >= 0 && idx < earliest) {
					earliest = idx;
					markerLen = marker.length;
				}
			}
			thinking += remaining.slice(0, earliest);
			if (earliest === remaining.length) break;
			remaining = remaining.slice(earliest + markerLen);
			inThinking = false;
		}
	}

	return {
		thinking: thinking.trim(),
		main: main.trim(),
		isThinking: inThinking,
	};
}

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

type StreamEvent =
	| { type: "content"; chunk: string }
	| { type: "tool_calls"; calls: ToolCall[] };

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

function cleanMessagesForNoTools(
	messages: ConversationMessage[],
): ConversationMessage[] {
	return messages.reduce<ConversationMessage[]>((acc, msg) => {
		if (msg.role === "tool") {
			acc.push({
				role: "user",
				content: `[도구 실행 결과]: ${msg.content}`,
			});
		} else if (msg.role === "assistant" && msg.tool_calls?.length) {
			acc.push({ role: "assistant", content: msg.content || "" });
		} else {
			acc.push(msg);
		}
		return acc;
	}, []);
}

async function* callLLMStreaming(
	messages: ConversationMessage[],
	tools?: OpenAITool[],
	allowFallback = true,
): AsyncGenerator<StreamEvent> {
	const url = `${state.llmApiUrl.replace(/\/$/, "")}/v1/chat/completions`;

	const effectiveTools =
		toolCallingSupportedCache === false ? undefined : tools;

	const body: Record<string, unknown> = {
		model: state.llmChatModel,
		messages,
		stream: true,
	};
	if (effectiveTools && effectiveTools.length > 0) {
		body["tools"] = effectiveTools;
		body["tool_choice"] = "auto";
	}

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		if (
			response.status >= 500 &&
			effectiveTools &&
			effectiveTools.length > 0 &&
			allowFallback
		) {
			const hasDirtyHistory = messages.some(
				(m) =>
					m.role === "tool" ||
					(m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0),
			);
			if (!hasDirtyHistory) {
				toolCallingSupportedCache = false;
			}
			debugLogger.warn(
				hasDirtyHistory
					? "[LLM] Tool history caused server error, retrying with cleaned messages"
					: "[LLM] Tool calling not supported by server, falling back to no-tools mode",
			);
			const cleanMessages = cleanMessagesForNoTools(messages);
			yield* callLLMStreaming(cleanMessages, undefined, false);
			return;
		}
		const errorText = await response.text();
		throw new Error(`LLM API Error (${response.status}): ${errorText}`);
	}

	if (effectiveTools && effectiveTools.length > 0) {
		toolCallingSupportedCache = true;
	}

	const reader = response.body?.getReader();
	if (!reader) throw new Error("Response body is null");

	const decoder = new TextDecoder();
	let buffer = "";
	const toolCallAccum = new Map<
		number,
		{ id: string; name: string; arguments: string }
	>();

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.replace(/^data: /, "").trim();
			if (!trimmed || trimmed === "[DONE]") continue;

			try {
				const parsed = JSON.parse(trimmed) as {
					choices?: Array<{
						delta?: {
							content?: string | null;
							tool_calls?: Array<{
								index: number;
								id?: string;
								function?: { name?: string; arguments?: string };
							}>;
						};
						finish_reason?: string | null;
					}>;
				};

				const choice = parsed.choices?.[0];
				if (!choice) continue;

				const delta = choice.delta;

				if (delta?.content) {
					yield { type: "content", chunk: delta.content };
				}

				if (delta?.tool_calls) {
					for (const tc of delta.tool_calls) {
						const existing = toolCallAccum.get(tc.index);
						if (!existing) {
							toolCallAccum.set(tc.index, {
								id: tc.id ?? "",
								name: tc.function?.name ?? "",
								arguments: tc.function?.arguments ?? "",
							});
						} else {
							if (tc.id) existing.id = tc.id;
							if (tc.function?.name) existing.name += tc.function.name;
							if (tc.function?.arguments)
								existing.arguments += tc.function.arguments;
						}
					}
				}

				const finishedWithTools =
					(choice.finish_reason === "tool_calls" ||
						choice.finish_reason === "stop") &&
					toolCallAccum.size > 0;

				if (finishedWithTools) {
					const calls: ToolCall[] = Array.from(toolCallAccum.entries())
						.sort(([a], [b]) => a - b)
						.map(([, tc]) => ({
							id: tc.id,
							type: "function" as const,
							function: { name: tc.name, arguments: tc.arguments },
						}));
					yield { type: "tool_calls", calls };
					return;
				}
			} catch (_e) {}
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
							let args: Record<string, unknown> = {};
							try {
								args = JSON.parse(tc.function.arguments) as Record<
									string,
									unknown
								>;
							} catch {}

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
