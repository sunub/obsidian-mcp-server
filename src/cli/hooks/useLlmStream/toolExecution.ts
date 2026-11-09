import { MAX_TOOL_RESULT_CHARS } from "@cli/hooks/useLlmStream/constants.js";
import type { ToolCall } from "@cli/hooks/useLlmStream/types.js";
import type { CallToolFn } from "@cli/types.js";

export interface ToolCallOutcome {
	content: string;
	isError: boolean;
}

function parseToolArguments(
	toolName: string,
	rawArguments: string,
): { args: Record<string, unknown> } | { error: string } {
	if (!rawArguments.trim()) {
		return { args: {} };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawArguments);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			error: `Tool call error: arguments for "${toolName}" are not valid JSON (${reason}). Call the tool again with a single JSON object.`,
		};
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return {
			error: `Tool call error: arguments for "${toolName}" must be a JSON object. Call the tool again with a single JSON object.`,
		};
	}

	return { args: parsed as Record<string, unknown> };
}

// 잘렸다는 표시가 없으면 모델이 일부만 받은 결과를 전체로 오해한다.
function limitToolResult(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	const notice = `\n[truncated: showing the start of a ${text.length}-character result. Request a narrower result if more is needed.]`;
	return `${text.slice(0, Math.max(0, maxChars - notice.length))}${notice}`;
}

/** 도구 실패를 턴 전체의 실패로 끝내지 않고, 모델이 고칠 수 있도록 tool 메시지로 돌려준다. */
export async function executeToolCall(
	call: ToolCall,
	callTool: CallToolFn,
	maxChars: number = MAX_TOOL_RESULT_CHARS,
): Promise<ToolCallOutcome> {
	const parsed = parseToolArguments(
		call.function.name,
		call.function.arguments,
	);
	if ("error" in parsed) {
		return { content: parsed.error, isError: true };
	}

	try {
		const result = await callTool(call.function.name, parsed.args);
		const text = result.content.map((c) => c.text ?? "").join("\n");
		const isError = result.isError === true;
		return {
			content: limitToolResult(
				isError ? `Tool returned an error: ${text}` : text,
				maxChars,
			),
			isError,
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			content: limitToolResult(`Tool execution error: ${reason}`, maxChars),
			isError: true,
		};
	}
}
