import type { ServerConnectionInfo } from "@cli/services/McpManager.js";
import { theme } from "@cli/theme/semantic-colors.js";
import { Box, Text } from "ink";
import type React from "react";
import { useMemo } from "react";

interface MCPServersProps {
	isConnected: boolean;
	connections: Map<string, ServerConnectionInfo>;
	serverCount: number;
	connectedCount: number;
	errors: Map<string, Error>;
}

export const MCPServers: React.FC<MCPServersProps> = ({
	isConnected,
	serverCount,
	connectedCount,
	errors,
}) => {
	const summaryMessage = useMemo(() => {
		if (serverCount === 0) return "설정된 MCP 서버가 없습니다.";
		return `${connectedCount} MCP`;
	}, [serverCount, connectedCount]);

	if (serverCount === 0) return null;

	return (
		<Box flexDirection="row">
			<Box>
				<Text color={isConnected ? theme.text.primary : "yellow"} bold>
					{summaryMessage}
				</Text>
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
