import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import type { UseMcpManagerReturn } from "../hooks/useMcpManager.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import type { LLMHealthStatus } from "../types.js";
import { AppEvent, appEvents } from "../utils/events.js";

interface LLMHealthCheckerProps {
	setLLMStatus: (status: LLMHealthStatus) => void;
	setErrorMessage: (message: string) => void;
	mcp: UseMcpManagerReturn;
}

export function isNarrowWidth(width: number): boolean {
	return width < 80;
}

export function LLMStatusLoader({ setLLMStatus, mcp }: LLMHealthCheckerProps) {
	const { columns: terminalWidth } = useTerminalSize();
	const isNarrow = isNarrowWidth(terminalWidth);
	const [messages, setMessages] = useState<string[]>([]);
	const {
		isConnected: mcpConnected,
		isAnyConnecting,
		connectedCount,
		serverCount,
	} = mcp;

	useEffect(() => {
		const handleLog = (message: string) => {
			setMessages((prev) => [...prev.slice(-9), message]);
		};

		appEvents.on(AppEvent.OpenDebugConsole, handleLog);
		return () => {
			appEvents.off(AppEvent.OpenDebugConsole, handleLog);
		};
	}, []);

	useEffect(() => {
		if (mcpConnected && !isAnyConnecting && serverCount > 0) {
			const timer = setTimeout(() => {
				setLLMStatus("success");
			}, 800);
			return () => clearTimeout(timer);
		}

		return;
	}, [mcpConnected, isAnyConnecting, serverCount, setLLMStatus]);

	return (
		<Box
			paddingX={2}
			paddingY={1}
			width="100%"
			flexDirection={isNarrow ? "column" : "row"}
			alignItems={isNarrow ? "flex-start" : "center"}
		>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					<Spinner type="dots" /> Initializing System Resources
				</Text>
			</Box>

			<Box flexDirection="column" paddingLeft={2}>
				{messages.map((msg, i) => (
					<Text key={msg} color="gray">
						{i === messages.length - 1 ? "●" : "○"} {msg}
					</Text>
				))}
			</Box>

			<Box marginTop={1}>
				<Text dimColor>
					MCP Servers: {connectedCount}/{serverCount} connected
				</Text>
			</Box>
		</Box>
	);
}
