export interface OpenAITool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters: Record<string, unknown>;
	};
}

export interface ToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export type ConversationMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| { role: "assistant"; content: string; tool_calls?: ToolCall[] }
	| { role: "tool"; content: string; tool_call_id: string };

export type StreamEvent =
	| { type: "content"; chunk: string }
	| { type: "tool_calls"; calls: ToolCall[] };
