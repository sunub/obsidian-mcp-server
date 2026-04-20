import type { McpServerConfig } from "../config/mcpServersConfig.js";
import type { McpConnectionState, McpToolResult } from "../types.js";
import { debugLogger } from "../utils/debugLogger.js";
import type { McpConnectionOptions, McpToolInfo } from "./McpClientService.js";
import { McpClientService } from "./McpClientService.js";

/** 도구 라우팅 테이블 엔트리 — 도구 이름 → 소속 서버 */
interface ToolRouteEntry {
	serverName: string;
	tool: McpToolInfo;
}

/** 서버별 연결 상태 스냅샷 */
export interface ServerConnectionInfo {
	state: McpConnectionState;
	toolCount: number;
	error: Error | null;
}

/**
 * McpManager — 다중 MCP 서버 연결 및 도구 라우팅 관리자.
 *
 * - 여러 McpClientService 인스턴스를 병렬 관리
 * - Promise.allSettled로 연결하여 개별 실패가 전체를 블로킹하지 않음
 * - 도구 이름 → 서버 매핑 테이블로 callTool 라우팅
 */
export class McpManager {
	private services: Map<string, McpClientService> = new Map();
	private configs: Map<string, McpServerConfig> = new Map();
	private connectionStates: Map<string, McpConnectionState> = new Map();
	private connectionErrors: Map<string, Error> = new Map();
	private toolRegistry: Map<string, ToolRouteEntry> = new Map();
	private serverTools: Map<string, McpToolInfo[]> = new Map();

	// ─── 상태 접근자 ─────────────────────────────────

	/** 서버별 연결 상태 */
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

	/** 모든 서버에서 수집된 도구 통합 목록 */
	get allTools(): McpToolInfo[] {
		return Array.from(this.toolRegistry.values()).map((entry) => entry.tool);
	}

	/** 서버별 도구 목록 (UI 그룹핑용) */
	get toolsByServer(): Map<string, McpToolInfo[]> {
		return new Map(this.serverTools);
	}

	/** 하나라도 연결되었는지 (Partial Readiness) */
	get isPartiallyReady(): boolean {
		for (const state of this.connectionStates.values()) {
			if (state === "connected") return true;
		}
		return false;
	}

	/** 연결된 서버 수 */
	get connectedCount(): number {
		let count = 0;
		for (const state of this.connectionStates.values()) {
			if (state === "connected") count++;
		}
		return count;
	}

	/** 설정된 전체 서버 수 */
	get serverCount(): number {
		return this.configs.size;
	}

	/** 서버별 에러 맵 */
	get errors(): Map<string, Error> {
		return new Map(this.connectionErrors);
	}

	// ─── 라이프사이클 ───────────────────────────────

	/**
	 * 모든 설정된 서버에 병렬 연결을 시도한다.
	 * Promise.allSettled를 사용하여 개별 실패가 전체를 블로킹하지 않는다.
	 *
	 * @param onStateChange 상태 변경 시 호출되는 콜백 (React 상태 동기화용)
	 */
	async connectAll(
		serverConfigs: McpServerConfig[],
		onStateChange?: () => void,
	): Promise<void> {
		// 설정 저장 및 초기 상태 설정
		for (const config of serverConfigs) {
			this.configs.set(config.name, config);
			this.connectionStates.set(config.name, "connecting");

			const service = new McpClientService();
			this.services.set(config.name, service);
		}
		onStateChange?.();

		// 병렬 연결
		const results = await Promise.allSettled(
			serverConfigs.map((config) => this.connectSingle(config, onStateChange)),
		);

		// 결과 로깅
		const succeeded = results.filter((r) => r.status === "fulfilled").length;
		const failed = results.filter((r) => r.status === "rejected").length;

		debugLogger.log(
			`[McpManager] 연결 완료: ${succeeded}/${serverConfigs.length} 성공, ${failed} 실패`,
		);
	}

	/**
	 * 모든 서버 연결을 정리한다.
	 */
	async disconnectAll(): Promise<void> {
		debugLogger.log("[McpManager] 모든 서버 연결 해제 중...");

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

		debugLogger.log("[McpManager] 모든 서버 연결 해제 완료.");
	}

	// ─── 도구 라우팅 ────────────────────────────────

	/**
	 * 도구 이름으로 적절한 서버에 요청을 라우팅한다.
	 */
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

	// ─── 내부 메서드 ────────────────────────────────

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

			// 도구 목록 수집 및 라우팅 테이블 구축
			const tools = await service.listTools();
			this.serverTools.set(config.name, tools);
			this.registerTools(config.name, tools);

			debugLogger.log(
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

	/**
	 * 도구 라우팅 테이블에 서버의 도구들을 등록한다.
	 * 충돌 시 먼저 등록된 서버가 우선된다 (FIFO).
	 */
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
