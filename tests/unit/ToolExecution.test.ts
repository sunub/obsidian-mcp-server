import { describe, expect, test, vi } from "vitest";
import { executeToolCall } from "../../src/cli/hooks/useLlmStream/toolExecution.js";
import type { ToolCall } from "../../src/cli/hooks/useLlmStream/types.js";
import type { CallToolFn } from "../../src/cli/types.js";

function toolCall(args: string): ToolCall {
	return {
		id: "call_1",
		type: "function",
		function: { name: "vault", arguments: args },
	};
}

function returning(text: string, isError = false): CallToolFn {
	return vi.fn(async () => ({
		isError,
		content: [{ type: "text", text }],
	}));
}

describe("executeToolCall", () => {
	test("passes parsed arguments and returns the tool text", async () => {
		const callTool = returning("found");

		const outcome = await executeToolCall(
			toolCall('{"action":"stats"}'),
			callTool,
		);

		expect(callTool).toHaveBeenCalledWith("vault", { action: "stats" });
		expect(outcome).toEqual({ content: "found", isError: false });
	});

	test("treats empty arguments as an empty object", async () => {
		const callTool = returning("ok");

		await executeToolCall(toolCall(""), callTool);

		expect(callTool).toHaveBeenCalledWith("vault", {});
	});

	test("reports malformed JSON to the model without calling the tool", async () => {
		const callTool = returning("unused");

		const outcome = await executeToolCall(
			toolCall('{"action":"search"'),
			callTool,
		);

		expect(callTool).not.toHaveBeenCalled();
		expect(outcome.isError).toBe(true);
		expect(outcome.content).toContain("not valid JSON");
		expect(outcome.content).toContain("vault");
	});

	test.each([
		"null",
		"[]",
		"1",
	])("rejects non-object arguments: %s", async (args) => {
		const callTool = returning("unused");

		const outcome = await executeToolCall(toolCall(args), callTool);

		expect(callTool).not.toHaveBeenCalled();
		expect(outcome.isError).toBe(true);
		expect(outcome.content).toContain("JSON object");
	});

	test("returns a thrown tool failure as an error result", async () => {
		const callTool: CallToolFn = vi.fn(async () => {
			throw new Error("server disconnected");
		});

		const outcome = await executeToolCall(toolCall("{}"), callTool);

		expect(outcome.isError).toBe(true);
		expect(outcome.content).toContain("server disconnected");
	});

	test("marks results the tool reported as errors", async () => {
		const outcome = await executeToolCall(
			toolCall("{}"),
			returning("Unknown action", true),
		);

		expect(outcome.isError).toBe(true);
		expect(outcome.content).toContain("Tool returned an error");
		expect(outcome.content).toContain("Unknown action");
	});

	test("marks truncation and stays within the limit", async () => {
		const outcome = await executeToolCall(
			toolCall("{}"),
			returning("x".repeat(1000)),
			200,
		);

		expect(outcome.content.length).toBeLessThanOrEqual(200);
		expect(outcome.content).toContain("truncated");
		expect(outcome.content).toContain("1000");
		expect(outcome.isError).toBe(false);
	});

	test("leaves results at the limit untouched", async () => {
		const text = "x".repeat(200);

		const outcome = await executeToolCall(toolCall("{}"), returning(text), 200);

		expect(outcome.content).toBe(text);
	});
});
