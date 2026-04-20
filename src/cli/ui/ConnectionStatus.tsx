/**
 * ConnectionStatus — 다중 MCP 서버 연결 상태 표시기
 *
 * 터미널 상단에 각 MCP 서버의 연결 상태를 시각적으로 표시합니다.
 */

import { Box, Text } from "ink";
import type React from "react";
import type { ServerConnectionInfo } from "../services/McpManager.js";
import type { McpConnectionState } from "../types.js";

interface ConnectionStatusProps {
	connections: Map<string, ServerConnectionInfo>;
	errors: Map<string, Error>;
}

const STATE_CONFIG: Record<
	McpConnectionState,
	{ symbol: string; color: string; label: string }
> = {
	connected: { symbol: "●", color: "green", label: "Connected" },
	connecting: { symbol: "○", color: "yellow", label: "Connecting..." },
	disconnected: { symbol: "◌", color: "gray", label: "Disconnected" },
	error: { symbol: "✖", color: "red", label: "Error" },
};

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
	connections,
	errors,
}) => {
	if (connections.size === 0) {
		return (
			<Box paddingX={1} marginBottom={1}>
				<Text color="gray">◌ MCP 서버가 설정되지 않았습니다</Text>
			</Box>
		);
	}

	return (
		<Box paddingX={1} marginBottom={1} flexDirection="column">
			{Array.from(connections.entries()).map(([serverName, info]) => {
				const config = STATE_CONFIG[info.state];
				const serverError = errors.get(serverName);

				return (
					<Box key={serverName} flexDirection="row">
						<Text color={config.color}>
							{config.symbol} {serverName}
						</Text>
						<Text color="gray">
							{" — "}
							{config.label}
						</Text>
						{info.state === "connected" && info.toolCount > 0 && (
							<Text color="gray"> ({info.toolCount} tools)</Text>
						)}
						{info.state === "error" && serverError && (
							<Text color="red"> ({serverError.message})</Text>
						)}
					</Box>
				);
			})}
		</Box>
	);
};
