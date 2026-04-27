import type { McpServerConfig } from "@cli/config/mcpServersConfig.js";
import type {
	McpConnectionOptions,
	McpToolInfo,
} from "@cli/services/McpClientService.js";
import { McpClientService } from "@cli/services/McpClientService.js";
import type { McpConnectionState, McpToolResult } from "@cli/types.js";
import { debugLogger } from "@sunub/core";

interface ToolRouteEntry {
	serverName: string;
	tool: McpToolInfo;
}

export interface ServerConnectionInfo {
	state: McpConnectionState;
	toolCount: number;
	error: Error | null;
}

export class McpManager {
	private services: Map<string, McpClientService> = new Map();
	private configs: Map<string, McpServerConfig> = new Map();
	private connectionStates: Map<string, McpConnectionState> = new Map();
	private connectionErrors: Map<string, Error> = new Map();
	private toolRegistry: Map<string, ToolRouteEntry> = new Map();
	private serverTools: Map<string, McpToolInfo[]> = new Map();

	get connections(): Map<string, ServerConnectionInfo> {
		const result = new Map<string, ServerConnectionInfo>();
		for (const [name] of this.configs) {
			result.set(name, {
				state: this.connectionStates.get(name) ?? "disconnected",
				toolCount: this.serverTools.get(name)?.length ?? 0,
				error: this.connectionErrors.get(name) ?? null,
			});
		}
		return result;
	}

	get allTools(): McpToolInfo[] {
		return Array.from(this.toolRegistry.values()).map((entry) => entry.tool);
	}

	get toolsByServer(): Map<string, McpToolInfo[]> {
		return new Map(this.serverTools);
	}

	get isPartiallyReady(): boolean {
		for (const state of this.connectionStates.values()) {
			if (state === "connected") return true;
		}
		return false;
	}

	get connectedCount(): number {
		let count = 0;
		for (const state of this.connectionStates.values()) {
			if (state === "connected") count++;
		}
		return count;
	}

	get serverCount(): number {
		return this.configs.size;
	}

	get errors(): Map<string, Error> {
		return new Map(this.connectionErrors);
	}

	async connectAll(
		serverConfigs: McpServerConfig[],
		onStateChange?: () => void,
	): Promise<void> {
		for (const config of serverConfigs) {
			this.configs.set(config.name, config);
			this.connectionStates.set(config.name, "connecting");

			const service = new McpClientService();
			this.services.set(config.name, service);
		}
		onStateChange?.();

		const results = await Promise.allSettled(
			serverConfigs.map((config) => this.connectSingle(config, onStateChange)),
		);

		const succeeded = results.filter((r) => r.status === "fulfilled").length;
		const failed = results.filter((r) => r.status === "rejected").length;

		debugLogger.info(
			`[McpManager] 연결 완료: ${succeeded}/${serverConfigs.length} 성공, ${failed} 실패`,
		);
	}

	async disconnectAll(): Promise<void> {
		debugLogger.info("[McpManager] 모든 서버 연결 해제 중...");

		const disconnectPromises: Promise<void>[] = [];
		for (const [name, service] of this.services) {
			disconnectPromises.push(
				service.disconnect().catch((err: unknown) => {
					debugLogger.error(`[McpManager] "${name}" 연결 해제 실패:`, err);
				}),
			);
		}

		await Promise.allSettled(disconnectPromises);

		this.services.clear();
		this.configs.clear();
		this.connectionStates.clear();
		this.connectionErrors.clear();
		this.toolRegistry.clear();
		this.serverTools.clear();

		debugLogger.info("[McpManager] 모든 서버 연결 해제 완료.");
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<McpToolResult> {
		const route = this.toolRegistry.get(name);

		if (!route) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `도구 "${name}"을(를) 찾을 수 없습니다. /tools 명령으로 사용 가능한 도구를 확인하세요.`,
					},
				],
			};
		}

		const service = this.services.get(route.serverName);
		if (!service?.isConnected) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `도구 "${name}"의 서버 "${route.serverName}"이(가) 연결되지 않았습니다.`,
					},
				],
			};
		}

		return service.callTool(name, args);
	}

	private async connectSingle(
		config: McpServerConfig,
		onStateChange?: () => void,
	): Promise<void> {
		const service = this.services.get(config.name);
		if (!service) return;

		const options: McpConnectionOptions = {
			command: config.command,
			args: config.args,
			env: config.env,
			cwd: config.cwd,
		};

		try {
			await service.connect(options);
			this.connectionStates.set(config.name, "connected");
			onStateChange?.();

			const tools = await service.listTools();
			this.serverTools.set(config.name, tools);
			this.registerTools(config.name, tools);

			debugLogger.info(
				`[McpManager] "${config.name}" 연결 완료 — ${tools.length}개 도구: ${tools.map((t) => t.name).join(", ")}`,
			);
			onStateChange?.();
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			this.connectionStates.set(config.name, "error");
			this.connectionErrors.set(config.name, error);

			debugLogger.error(
				`[McpManager] "${config.name}" 연결 실패:`,
				error.message,
			);
			onStateChange?.();
			throw error;
		}
	}

	private registerTools(serverName: string, tools: McpToolInfo[]): void {
		for (const tool of tools) {
			if (this.toolRegistry.has(tool.name)) {
				const existing = this.toolRegistry.get(tool.name);
				debugLogger.warn(
					`[McpManager] 도구 이름 충돌: "${tool.name}" — ` +
						`"${existing?.serverName}" (기존) vs "${serverName}" (무시됨)`,
				);
				continue;
			}

			this.toolRegistry.set(tool.name, { serverName, tool });
		}
	}
}
