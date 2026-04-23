import type { McpToolInfo } from "../../services/McpClientService.js";
import { THINK_END, THINK_START } from "./constants.js";
import type { ConversationMessage, OpenAITool } from "./types.js";

export function parseThinkingContent(raw: string): {
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

export function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

export function mcpToolsToOpenAI(tools: McpToolInfo[]): OpenAITool[] {
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

export function cleanMessagesForNoTools(
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

export function prepareInitialMessages(
	text: string,
	ragContext: string | null | undefined,
	history: ConversationMessage[],
): {
	messages: ConversationMessage[];
	userMessage: ConversationMessage;
} {
	const messages: ConversationMessage[] = [];
	if (ragContext) {
		messages.push({ role: "system", content: ragContext });
	}
	messages.push(...history);

	const userMessage: ConversationMessage = {
		role: "user",
		content: text,
	};
	messages.push(userMessage);

	return { messages, userMessage };
}

export function formatToolArguments(argsJson: string): string {
	let args: Record<string, unknown> = {};
	try {
		args = JSON.parse(argsJson) as Record<string, unknown>;
	} catch {
		return "";
	}

	return Object.entries(args)
		.map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 30)}`)
		.join(", ");
}
