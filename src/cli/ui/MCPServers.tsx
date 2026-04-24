import { Box, Text } from "ink";
import type React from "react";
import { useMemo } from "react";
import type { ServerConnectionInfo } from "../services/McpManager.js";

interface MCPServersProps {
	isConnected: boolean;
	connections: Map<string, ServerConnectionInfo>;
	serverCount: number;
	connectedCount: number;
	errors: Map<string, Error>;
}

export const MCPServers: React.FC<MCPServersProps> = ({
	isConnected,
	connections,
	serverCount,
	connectedCount,
	errors,
}) => {
	const connectingServers = useMemo(
		() =>
			Array.from(connections.entries())
				.filter(([_, info]) => info.state === "connected")
				.map(([name, _]) => name),
		[connections],
	);

	const summaryMessage = useMemo(() => {
		if (serverCount === 0) return "설정된 MCP 서버가 없습니다.";

		const status = isConnected ? "연결됨" : "연결 대기 중";
		return `MCP 서버: ${connectedCount}/${serverCount} ${status}`;
	}, [isConnected, serverCount, connectedCount]);

	if (serverCount === 0) return null;

	return (
		<Box flexDirection="column" paddingX={1} marginBottom={1}>
			<Box>
				<Text color={isConnected ? "green" : "yellow"} bold>
					● {summaryMessage}
				</Text>
				{connectingServers.length > 0 && (
					<Text color="gray"> (연결 중: {connectingServers.join(", ")})</Text>
				)}
			</Box>

			{errors.size > 0 && (
				<Box flexDirection="column" marginTop={0}>
					{Array.from(errors.entries()).map(([serverName, error]) => (
						<Text key={serverName} color="red">
							└ ⚠ {serverName}: {error.message}
						</Text>
					))}
				</Box>
			)}
		</Box>
	);
};
