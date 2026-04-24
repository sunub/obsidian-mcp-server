import state from "../../../config.js";
import { debugLogger } from "../../utils/debugLogger.js";
import type {
	ConversationMessage,
	OpenAITool,
	StreamEvent,
	ToolCall,
} from "./types.js";
import { cleanMessagesForNoTools } from "./utils.js";

let toolCallingSupportedCache: boolean | null = null;

export async function* callLLMStreaming(
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
