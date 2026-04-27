import type { McpServerConfig } from "@cli/config/mcpServersConfig";
import { McpClientService } from "@cli/services/McpClientService";
import { McpManager } from "@cli/services/McpManager";
import { beforeEach, describe, expect, test, vi } from "vitest";

// McpClientService를 모킹
vi.mock("@cli/services/McpClientService", () => {
	return {
		McpClientService: vi.fn().mockImplementation(() => ({
			isConnected: false,
			connect: vi.fn(),
			disconnect: vi.fn(),
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn(),
		})),
	};
});

function createMockConfig(
	name: string,
	overrides?: Partial<McpServerConfig>,
): McpServerConfig {
	return {
		name,
		command: "node",
		args: ["server.js"],
		env: {},
		...overrides,
	};
}

describe("McpManager", () => {
	let manager: McpManager;

	beforeEach(() => {
		vi.clearAllMocks();
		manager = new McpManager();
	});

	describe("connectAll — 다중 서버 연결", () => {
		test("모든 서버가 성공적으로 연결된다", async () => {
			const MockService = vi.mocked(McpClientService);
			MockService.mockImplementation(
				() =>
					({
						isConnected: true,
						connect: vi.fn().mockResolvedValue(undefined),
						disconnect: vi.fn().mockResolvedValue(undefined),
						listTools: vi
							.fn()
							.mockResolvedValue([{ name: "tool_a", description: "Tool A" }]),
						callTool: vi.fn(),
					}) as unknown as McpClientService,
			);

			const configs = [
				createMockConfig("server1"),
				createMockConfig("server2"),
			];

			await manager.connectAll(configs);

			expect(manager.connectedCount).toBe(2);
			expect(manager.serverCount).toBe(2);
			expect(manager.isPartiallyReady).toBe(true);
		});

		test("Partial Failure — 일부 서버 실패 시 나머지는 정상 동작", async () => {
			let callCount = 0;
			const MockService = vi.mocked(McpClientService);
			MockService.mockImplementation(() => {
				callCount++;
				const shouldFail = callCount === 2;

				return {
					isConnected: !shouldFail,
					connect: shouldFail
						? vi.fn().mockRejectedValue(new Error("Connection refused"))
						: vi.fn().mockResolvedValue(undefined),
					disconnect: vi.fn().mockResolvedValue(undefined),
					listTools: vi
						.fn()
						.mockResolvedValue(
							shouldFail
								? []
								: [{ name: `tool_${callCount}`, description: "test" }],
						),
					callTool: vi.fn(),
				} as unknown as McpClientService;
			});

			const configs = [
				createMockConfig("good-server"),
				createMockConfig("bad-server"),
			];

			await manager.connectAll(configs);

			expect(manager.connectedCount).toBe(1);
			expect(manager.serverCount).toBe(2);
			expect(manager.isPartiallyReady).toBe(true);

			// 실패한 서버의 에러 확인
			const errors = manager.errors;
			expect(errors.has("bad-server")).toBe(true);
			expect(errors.get("bad-server")?.message).toBe("Connection refused");
		});
	});

	describe("도구 라우팅", () => {
		test("도구 이름으로 올바른 서버에 라우팅된다", async () => {
			const mockCallTool = vi.fn().mockResolvedValue({
				isError: false,
				content: [{ type: "text", text: "ok" }],
			});

			let callCount = 0;
			const MockService = vi.mocked(McpClientService);
			MockService.mockImplementation(() => {
				callCount++;
				const toolName = callCount === 1 ? "vault" : "web_search";

				return {
					isConnected: true,
					connect: vi.fn().mockResolvedValue(undefined),
					disconnect: vi.fn().mockResolvedValue(undefined),
					listTools: vi
						.fn()
						.mockResolvedValue([{ name: toolName, description: "test" }]),
					callTool: mockCallTool,
				} as unknown as McpClientService;
			});

			await manager.connectAll([
				createMockConfig("obsidian"),
				createMockConfig("web"),
			]);

			expect(manager.allTools).toHaveLength(2);

			// vault 도구 호출 → obsidian 서버로 라우팅
			await manager.callTool("vault", { action: "search" });
			expect(mockCallTool).toHaveBeenCalledWith("vault", { action: "search" });
		});

		test("존재하지 않는 도구 호출 시 에러를 반환한다", async () => {
			const MockService = vi.mocked(McpClientService);
			MockService.mockImplementation(
				() =>
					({
						isConnected: true,
						connect: vi.fn().mockResolvedValue(undefined),
						disconnect: vi.fn().mockResolvedValue(undefined),
						listTools: vi
							.fn()
							.mockResolvedValue([{ name: "vault", description: "test" }]),
						callTool: vi.fn(),
					}) as unknown as McpClientService,
			);

			await manager.connectAll([createMockConfig("obsidian")]);

			const result = await manager.callTool("nonexistent_tool", {});

			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("nonexistent_tool");
		});

		test("도구 이름 충돌 시 먼저 등록된 서버가 우선된다 (FIFO)", async () => {
			const callToolFirst = vi.fn().mockResolvedValue({
				isError: false,
				content: [{ type: "text", text: "first" }],
			});
			const callToolSecond = vi.fn().mockResolvedValue({
				isError: false,
				content: [{ type: "text", text: "second" }],
			});

			let callCount = 0;
			const MockService = vi.mocked(McpClientService);
			MockService.mockImplementation(() => {
				callCount++;
				const isFirst = callCount === 1;

				return {
					isConnected: true,
					connect: vi.fn().mockResolvedValue(undefined),
					disconnect: vi.fn().mockResolvedValue(undefined),
					listTools: vi
						.fn()
						.mockResolvedValue([
							{ name: "duplicate_tool", description: "test" },
						]),
					callTool: isFirst ? callToolFirst : callToolSecond,
				} as unknown as McpClientService;
			});

			await manager.connectAll([
				createMockConfig("first-server"),
				createMockConfig("second-server"),
			]);

			const result = await manager.callTool("duplicate_tool", {});

			// 첫 번째 서버로 라우팅되어야 한다
			expect(callToolFirst).toHaveBeenCalled();
			expect(callToolSecond).not.toHaveBeenCalled();
			expect(result.content[0]?.text).toBe("first");
		});
	});

	describe("disconnectAll", () => {
		test("모든 서버의 연결을 해제하고 상태를 초기화한다", async () => {
			const mockDisconnect = vi.fn().mockResolvedValue(undefined);

			const MockService = vi.mocked(McpClientService);
			MockService.mockImplementation(
				() =>
					({
						isConnected: true,
						connect: vi.fn().mockResolvedValue(undefined),
						disconnect: mockDisconnect,
						listTools: vi.fn().mockResolvedValue([]),
						callTool: vi.fn(),
					}) as unknown as McpClientService,
			);

			await manager.connectAll([
				createMockConfig("server1"),
				createMockConfig("server2"),
			]);

			expect(manager.serverCount).toBe(2);

			await manager.disconnectAll();

			expect(manager.serverCount).toBe(0);
			expect(manager.connectedCount).toBe(0);
			expect(manager.allTools).toHaveLength(0);
			expect(manager.isPartiallyReady).toBe(false);
		});
	});

	describe("상태 접근자", () => {
		test("connections Map이 서버별 상태를 정확히 반영한다", async () => {
			let callCount = 0;
			const MockService = vi.mocked(McpClientService);
			MockService.mockImplementation(() => {
				callCount++;
				const shouldFail = callCount === 2;

				return {
					isConnected: !shouldFail,
					connect: shouldFail
						? vi.fn().mockRejectedValue(new Error("fail"))
						: vi.fn().mockResolvedValue(undefined),
					disconnect: vi.fn().mockResolvedValue(undefined),
					listTools: vi
						.fn()
						.mockResolvedValue(
							shouldFail ? [] : [{ name: "tool", description: "test" }],
						),
					callTool: vi.fn(),
				} as unknown as McpClientService;
			});

			await manager.connectAll([
				createMockConfig("ok-server"),
				createMockConfig("fail-server"),
			]);

			const connections = manager.connections;

			expect(connections.get("ok-server")?.state).toBe("connected");
			expect(connections.get("ok-server")?.toolCount).toBe(1);
			expect(connections.get("fail-server")?.state).toBe("error");
		});
	});
});
