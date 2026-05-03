import { loadMcpServersConfig } from "@cli/config/mcpServersConfig.js";
import type { McpToolInfo } from "@cli/services/McpClientService.js";
import {
	McpManager,
	type ServerConnectionInfo,
} from "@cli/services/McpManager.js";
import type { McpToolResult } from "@cli/types.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debugLogger } from "@/shared/index.js";
import { AppEvent, appEvents } from "../utils/events.js";

export interface UseMcpManagerReturn {
	isConnected: boolean;
	connections: Map<string, ServerConnectionInfo>;
	tools: McpToolInfo[];
	toolsByServer: Map<string, McpToolInfo[]>;
	callTool: (
		name: string,
		args: Record<string, unknown>,
	) => Promise<McpToolResult>;
	errors: Map<string, Error>;
	serverCount: number;
	connectedCount: number;
	isAnyConnecting: boolean;
	hasAnyError: boolean;
}

export const useMcpManager = (): UseMcpManagerReturn => {
	const [connections, setConnections] = useState<
		Map<string, ServerConnectionInfo>
	>(new Map());
	const [tools, setTools] = useState<McpToolInfo[]>([]);
	const [toolsByServer, setToolsByServer] = useState<
		Map<string, McpToolInfo[]>
	>(new Map());
	const [errors, setErrors] = useState<Map<string, Error>>(new Map());
	const [serverCount, setServerCount] = useState<number>(0);
	const [connectedCount, setConnectedCount] = useState<number>(0);
	const [isConnected, setIsConnected] = useState<boolean>(false);

	const isAnyConnecting = useMemo(
		() =>
			Array.from(connections.values()).some((c) => c.state === "connecting"),
		[connections],
	);
	const hasAnyError = errors.size > 0;

	const managerRef = useRef<McpManager | null>(null);

	const syncState = useCallback(() => {
		const manager = managerRef.current;
		if (!manager) return;

		setConnections(new Map(manager.connections));
		setTools([...manager.allTools]);
		setToolsByServer(new Map(manager.toolsByServer));
		setErrors(new Map(manager.errors));
		setServerCount(manager.serverCount);
		setConnectedCount(manager.connectedCount);
		setIsConnected(manager.isPartiallyReady);
	}, []);

	useEffect(() => {
		const manager = new McpManager();
		managerRef.current = manager;
		let cancelled = false;

		async function initConnections(): Promise<void> {
			try {
				appEvents.emit(
					AppEvent.OpenDebugConsole,
					"Initializing MCP connections...",
				);
				const configs = loadMcpServersConfig();

				if (configs.length === 0) {
					appEvents.emit(
						AppEvent.OpenDebugConsole,
						"No MCP servers configured.",
					);
					debugLogger.warn("[useMcpManager] 설정된 MCP 서버가 없습니다.");
					return;
				}

				appEvents.emit(
					AppEvent.OpenDebugConsole,
					`Connecting to ${configs.length} servers...`,
				);
				await manager.connectAll(configs, () => {
					if (!cancelled) {
						syncState();
					}
				});

				if (!cancelled) {
					appEvents.emit(
						AppEvent.OpenDebugConsole,
						"MCP connections established.",
					);
					syncState();
				}
			} catch (err) {
				appEvents.emit(
					AppEvent.OpenDebugConsole,
					`MCP initialization failed: ${err}`,
				);
				debugLogger.error("[useMcpManager] 초기화 실패:", err);
				if (!cancelled) {
					syncState();
				}
			}
		}

		void initConnections();

		return () => {
			cancelled = true;
			void manager.disconnectAll();
			managerRef.current = null;
		};
	}, [syncState]);

	const callTool = useCallback(
		async (
			name: string,
			args: Record<string, unknown>,
		): Promise<McpToolResult> => {
			if (!managerRef.current) {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: "MCP 서버가 초기화되지 않았습니다.",
						},
					],
				};
			}

			return managerRef.current.callTool(name, args);
		},
		[],
	);

	return {
		isConnected,
		connections,
		tools,
		toolsByServer,
		callTool,
		errors,
		serverCount,
		connectedCount,
		isAnyConnecting,
		hasAnyError,
	};
};
