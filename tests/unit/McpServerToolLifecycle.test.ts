import { describe, expect, test, vi } from "vitest";
import type { ServerLifecycle } from "../../src/utils/ServerLifecycle.js";

type RawToolCallback = (...args: unknown[]) => unknown;
type RegisterToolReceiver = {
	registerTool: (
		name: string,
		config: Record<string, unknown>,
		callback: RawToolCallback,
	) => unknown;
};

const registeredHandlers = vi.hoisted(
	() => new Map<string, RawToolCallback>(),
);
const registerToolSpy = vi.hoisted(() =>
	vi.fn(
		(
			name: string,
			_config: Record<string, unknown>,
			callback: RawToolCallback,
		) => {
			registeredHandlers.set(name, callback);
			return {
				remove: vi.fn(),
				update: vi.fn(),
				enable: vi.fn(),
				disable: vi.fn(),
			};
		},
	),
);

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
	McpServer: class {
		registerTool = registerToolSpy;
	},
}));

vi.mock("../../src/tools/index.js", () => ({
	default: {
		fakeTool: {
			register(server: RegisterToolReceiver) {
				server.registerTool("fake", {}, async (input: unknown) => ({
					content: [{ type: "text", text: JSON.stringify(input) }],
				}));
			},
		},
	},
}));

describe("createMcpServer tool lifecycle", () => {
	test("wraps registered tool callbacks in ServerLifecycle.runToolCall", async () => {
		const { default: createMcpServer } = await import("../../src/server.js");
		const lifecycle = {
			runToolCall: vi.fn(async (_name: string, task: () => Promise<unknown>) =>
				task(),
			),
		} as unknown as ServerLifecycle;

		registeredHandlers.clear();
		registerToolSpy.mockClear();

		createMcpServer(lifecycle);
		const handler = registeredHandlers.get("fake");

		expect(handler).toBeDefined();
		await handler?.({ ok: true });

		expect(lifecycle.runToolCall).toHaveBeenCalledTimes(1);
		expect(lifecycle.runToolCall).toHaveBeenCalledWith(
			"fake",
			expect.any(Function),
		);
	});
});
