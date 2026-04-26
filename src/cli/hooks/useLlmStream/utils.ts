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

export function minifyContext(text: string): string {
	// 1. 코드 블록(```...```)을 별도로 분리하여 보호
	const blocks: string[] = [];
	const placeholder = (idx: number) => `__CODE_BLOCK_${idx}__`;

	let processedText = text.replace(/```[\s\S]*?```/g, (match) => {
		blocks.push(match);
		return placeholder(blocks.length - 1);
	});

	// 2. 마크다운 주석 제거
	processedText = processedText.replace(/<!--[\s\S]*?-->/g, "");

	// 3. 3개 이상의 줄바꿈을 2개로 압축
	processedText = processedText.replace(/\n{3,}/g, "\n\n");

	// 4. 여러 개의 공백을 하나로 압축 (단, 줄바꿈은 유지)
	processedText = processedText.replace(/[ \t]{2,}/g, " ");

	// 5. 코드 블록 복원
	for (let i = 0; i < blocks.length; i++) {
		processedText = processedText.replace(placeholder(i), blocks[i]);
	}

	return processedText.trim();
}

export function truncateHistory(
	history: ConversationMessage[],
	maxChars = 6000,
): ConversationMessage[] {
	let currentChars = history.reduce((sum, msg) => sum + msg.content.length, 0);

	if (currentChars <= maxChars) return history;

	const truncated = [...history];
	// 최상단 system 메시지가 있다면 보존하기 위해 인덱스 1부터 탐색
	const hasSystem = truncated.length > 0 && truncated[0].role === "system";
	const startIndex = hasSystem ? 1 : 0;

	while (truncated.length > startIndex + 1 && currentChars > maxChars) {
		const removed = truncated.splice(startIndex, 1)[0];
		currentChars -= removed.content.length;
	}

	return truncated;
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
		messages.push({ role: "system", content: minifyContext(ragContext) });
	}
	messages.push(...history);

	const userMessage: ConversationMessage = {
		role: "user",
		content: minifyContext(text),
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
