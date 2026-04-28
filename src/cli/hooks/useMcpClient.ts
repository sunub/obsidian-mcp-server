import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	McpClientService,
	type McpConnectionOptions,
	type McpToolInfo,
} from "@cli/services/McpClientService.js";
import type { McpConnectionState, McpToolResult } from "@cli/types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { configSchema, debugLogger } from "@/shared/index.js";

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

function buildConnectionOptions(): McpConnectionOptions {
	console.error(
		"[useMcpClient] Building MCP connection options from environment variables...",
	);
	const env = configSchema.parse({
		vaultPath: process.env["VAULT_DIR_PATH"],
		loggingLevel: process.env["LOGGING_LEVEL"],
		llmApiUrl: process.env["LLM_API_URL"],
		llmEmbeddingApiUrl: process.env["LLM_EMBEDDING_API_URL"],
		llmEmbeddingModel: process.env["LLM_EMBEDDING_MODEL"],
		llmChatModel: process.env["LLM_CHAT_MODEL"],
	});
	const vaultPath = env.vaultPath;
	if (!vaultPath) {
		throw new Error(
			"VAULT_DIR_PATH 환경 변수가 설정되지 않았습니다. Obsidian Vault 경로를 지정해주세요.",
		);
	}

	// 현재 파일 위치를 기준으로 packages/server/dist/index.js 위치를 계산
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const serverEntry = path.resolve(__dirname, "../../../server/dist/index.js");
	const projectRoot = path.resolve(__dirname, "../../../../");

	return {
		command: "node",
		args: [serverEntry],
		cwd: projectRoot,
		env: {
			VAULT_DIR_PATH: vaultPath,
			LLM_API_URL: env.llmApiUrl ?? "http://127.0.0.1:8080",
			LLM_EMBEDDING_API_URL: env.llmEmbeddingApiUrl ?? "http://127.0.0.1:8081",
			LLM_EMBEDDING_MODEL: env.llmEmbeddingModel ?? "nomic-embed-text",
			LLM_CHAT_MODEL: env.llmChatModel ?? "llama3",
			LOGGING_LEVEL: process.env["LOGGING_LEVEL"] ?? "info",
		},
	};
}

export const useMcpClient = (): UseMcpClientReturn => {
	const [connectionState, setConnectionState] =
		useState<McpConnectionState>("disconnected");
	const [tools, setTools] = useState<McpToolInfo[]>([]);
	const [error, setError] = useState<Error | null>(null);
	const serviceRef = useRef<McpClientService | null>(null);

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

				const toolList = await service.listTools();
				if (!cancelled) {
					setTools(toolList);
					debugLogger.info(
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
