import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadMcpServersConfig } from "../config/mcpServersConfig.js";
import type { McpToolInfo } from "../services/McpClientService.js";
import {
  McpManager,
  type ServerConnectionInfo,
} from "../services/McpManager.js";
import type { McpToolResult } from "../types.js";
import { debugLogger } from "../utils/debugLogger.js";

export interface UseMcpManagerReturn {
  /** 하나라도 연결되었는지 (Partial Readiness) */
  isConnected: boolean;
  /** 서버별 연결 상태 */
  connections: Map<string, ServerConnectionInfo>;
  /** 모든 서버에서 수집된 통합 도구 목록 */
  tools: McpToolInfo[];
  /** 서버별 도구 목록 (UI 그룹핑용) */
  toolsByServer: Map<string, McpToolInfo[]>;
  /** 내부 라우팅된 도구 호출 함수 */
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<McpToolResult>;
  /** 서버별 에러 맵 */
  errors: Map<string, Error>;
  /** 설정된 서버 수 */
  serverCount: number;
  /** 연결된 서버 수 */
  connectedCount: number;
  /** 현재 연결 중인 서버가 있는지 여부 */
  isAnyConnecting: boolean;
  /** 에러가 발생한 서버가 있는지 여부 */
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
        const configs = loadMcpServersConfig();

        if (configs.length === 0) {
          debugLogger.warn("[useMcpManager] 설정된 MCP 서버가 없습니다.");
          return;
        }

        await manager.connectAll(configs, () => {
          if (!cancelled) {
            syncState();
          }
        });

        if (!cancelled) {
          syncState();
        }
      } catch (err) {
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
