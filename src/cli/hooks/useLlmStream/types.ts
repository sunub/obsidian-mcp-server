import z from "zod";

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

export const LLMResponseSchema = z.object({
	id: z.string(),
	object: z.string(),
	created: z.number(),
	model: z.string(),
	system_fingerprint: z.string().optional(),
	choices: z.array(
		z.object({
			index: z.number(),
			finish_reason: z.string().nullable().optional(),
			delta: z
				.object({
					role: z.string().optional(),
					content: z.string().optional(),
				})
				.passthrough(),
		}),
	),
	timings: z.record(z.number()).optional(),
});

export const SSEMessageSchema = z.object({
	data: z
		.string()
		.transform((str, ctx) => {
			if (str === "[DONE]") return { isDone: true };

			try {
				return JSON.parse(str);
			} catch (e) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Invalid JSON string",
				});
				return z.NEVER;
			}
		})
		.pipe(z.union([z.object({ isDone: z.literal(true) }), LLMResponseSchema])),
	id: z.string().optional(),
	event: z.string().optional(),
	retry: z.number().optional(),
});
