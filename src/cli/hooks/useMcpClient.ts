import { useState, useEffect, useCallback, useRef } from "react";
import {
  McpClientService,
  type McpConnectionOptions,
  type McpToolInfo,
} from "../services/McpClientService.js";
import { debugLogger } from "../utils/debugLogger.js";
import type { McpConnectionState, McpToolResult } from "../types.js";
import { configSchema } from "@/config.js";

export interface UseMcpClientReturn {
  isConnected: boolean;
  connectionState: McpConnectionState;
  tools: McpToolInfo[];
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<McpToolResult>;
  error: Error | null;
}

/**
 * MCP 서버 연결 옵션을 환경 변수로부터 구성합니다.
 */
function buildConnectionOptions(): McpConnectionOptions {
  console.log(
    "[useMcpClient] Building MCP connection options from environment variables...",
  );
  const env = configSchema.parse({
    vaultPath: process.env.VAULT_DIR_PATH,
    loggingLevel: process.env.LOGGING_LEVEL,
    llmApiUrl: process.env.LLM_API_URL,
    llmEmbeddingApiUrl: process.env.LLM_EMBEDDING_API_URL,
    llmEmbeddingModel: process.env.LLM_EMBEDDING_MODEL,
    llmChatModel: process.env.LLM_CHAT_MODEL,
  });
  const vaultPath = env.vaultPath;
  if (!vaultPath) {
    throw new Error(
      "VAULT_DIR_PATH 환경 변수가 설정되지 않았습니다. Obsidian Vault 경로를 지정해주세요.",
    );
  }

  const projectRoot = process.cwd();
  const serverEntry = "build/index.js";
  const command = "node";

  return {
    command,
    args: [serverEntry],
    cwd: projectRoot,
    env: {
      VAULT_DIR_PATH: vaultPath,
      LLM_API_URL: env.llmApiUrl ?? "http://127.0.0.1:8080",
      LLM_EMBEDDING_API_URL: env.llmEmbeddingApiUrl ?? "http://127.0.0.1:8081",
      LLM_EMBEDDING_MODEL: env.llmEmbeddingModel ?? "nomic-embed-text",
      LLM_CHAT_MODEL: env.llmChatModel ?? "llama3",
      LOGGING_LEVEL: process.env.LOGGING_LEVEL ?? "info",
    },
  };
}

export const useMcpClient = (): UseMcpClientReturn => {
  const [connectionState, setConnectionState] =
    useState<McpConnectionState>("disconnected");
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const serviceRef = useRef<McpClientService | null>(null);

  // 마운트 시 연결, 언마운트 시 정리
  useEffect(() => {
    const service = new McpClientService();
    serviceRef.current = service;
    let cancelled = false;

    async function initConnection() {
      setConnectionState("connecting");
      setError(null);

      try {
        const options = buildConnectionOptions();
        await service.connect(options);

        if (cancelled) {
          await service.disconnect();
          return;
        }

        setConnectionState("connected");

        // 도구 목록 조회
        const toolList = await service.listTools();
        if (!cancelled) {
          setTools(toolList);
          debugLogger.log(
            `[useMcpClient] ${toolList.length} tools available:`,
            toolList.map((t) => t.name).join(", "),
          );
        }
      } catch (err) {
        if (!cancelled) {
          const connectError =
            err instanceof Error ? err : new Error(String(err));
          debugLogger.error("[useMcpClient] Connection failed:", connectError);
          setConnectionState("error");
          setError(connectError);
        }
      }
    }

    void initConnection();

    return () => {
      cancelled = true;
      void service.disconnect();
      serviceRef.current = null;
    };
  }, []);

  const callTool = useCallback(
    async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<McpToolResult> => {
      if (!serviceRef.current?.isConnected) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "MCP 서버에 연결되지 않았습니다. 연결 상태를 확인해주세요.",
            },
          ],
        };
      }

      return serviceRef.current.callTool(name, args);
    },
    [],
  );

  return {
    isConnected: connectionState === "connected",
    connectionState,
    tools,
    callTool,
    error,
  };
};
