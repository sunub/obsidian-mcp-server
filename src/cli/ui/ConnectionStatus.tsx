/**
 * ConnectionStatus — MCP 연결 상태 표시기
 *
 * 터미널 상단에 MCP 서버 연결 상태를 시각적으로 표시합니다.
 */

import type React from "react";
import { Box, Text } from "ink";
import type { McpConnectionState } from "../types.js";

interface ConnectionStatusProps {
	connectionState: McpConnectionState;
	toolCount: number;
}

const STATUS_CONFIG: Record<
	McpConnectionState,
	{ symbol: string; color: string; label: string }
> = {
	connected: { symbol: "●", color: "green", label: "Obsidian MCP Connected" },
	connecting: { symbol: "○", color: "yellow", label: "Connecting to MCP..." },
	disconnected: { symbol: "✖", color: "gray", label: "MCP Disconnected" },
	error: { symbol: "✖", color: "red", label: "MCP Connection Error" },
};

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
	connectionState,
	toolCount,
}) => {
	const config = STATUS_CONFIG[connectionState];

	return (
		<Box paddingX={1} marginBottom={1}>
			<Text color={config.color}>
				{config.symbol} {config.label}
			</Text>
			{connectionState === "connected" && toolCount > 0 && (
				<Text color="gray"> ({toolCount} tools)</Text>
			)}
		</Box>
	);
};
