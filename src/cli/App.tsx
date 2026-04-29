import { InputContext } from "@cli/context/InputContext.js";
import { useDispatcher } from "@cli/hooks/useDispatcher.js";
import { useHistoryManager } from "@cli/hooks/useHistoryManager.js";
import { useInputHistoryStore } from "@cli/hooks/useInputHistory.js";
import { useKeyMatchers } from "@cli/hooks/useKeyMatchers.js";
import { type Key, useKeypress } from "@cli/hooks/useKeypress.js";
import { useLlmStream } from "@cli/hooks/useLlmStream/index.js";
import { useMcpManager } from "@cli/hooks/useMcpManager.js";
import { useRagContext } from "@cli/hooks/useRagContext.js";
import { useTerminalSize } from "@cli/hooks/useTerminalSize.js";
import { Command } from "@cli/key/keyMatchers.js";
import { useTextBuffer } from "@cli/key/text-buffer.js";
import { theme } from "@cli/theme/semantic-colors.js";
import { calculatePromptWidths, InputPrompt } from "@cli/ui/InputPrompt.js";
import { MainContent } from "@cli/ui/MainContent.js";
import { MCPServers } from "@cli/ui/MCPServers.js";
import { SystemInfoSummaryBox } from "@cli/ui/SystemInfoSummaryBox.js";
import { historyStorage } from "@cli/utils/historyStorage.js";
import { Box, Text } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debugLogger } from "@/shared/index.js";
import { disableMouseEvents } from "./utils/terminal.js";

export const App = () => {
	const [shellModeActive] = useState(false);
	const [copyModeEnabled, setCopyModeEnabled] = useState(false);
	const [showEscapePrompt] = useState(false);

	const lastCtrlCPress = useRef<number>(0);
	const keyMatchers = useKeyMatchers();

	const { columns: terminalWidth, rows: terminalHeight } = useTerminalSize();

	useEffect(() => {
		disableMouseEvents();
	}, []);

	//
	// useEffect(() => {
	//   if (copyModeEnabled) {
	//     process.stdout.write("\x1b[?1000l\x1b[?1003l\x1b[?1015l\x1b[?1006l");
	//   } else {
	//     process.stdout.write("\x1b[?1000h\x1b[?1003h\x1b[?1015h\x1b[?1006h");
	//   }
	//   return () => {
	//     process.stdout.write("\x1b[?1000l\x1b[?1003l\x1b[?1015l\x1b[?1006l");
	//   };
	// }, [copyModeEnabled]);

	const mainAreaWidth = terminalWidth;
	const { inputWidth, suggestionsWidth } = useMemo(() => {
		const { inputWidth, suggestionsWidth } =
			calculatePromptWidths(mainAreaWidth);
		return { inputWidth, suggestionsWidth };
	}, [mainAreaWidth]);

	const availableTerminalHeight = Math.max(0, terminalHeight - 2);
	const { inputHistory, addInput, initializeFromLogger } =
		useInputHistoryStore();

	const {
		isConnected: mcpConnected,
		connections: mcpConnections,
		tools: mcpTools,
		toolsByServer: mcpToolsByServer,
		callTool,
		errors: mcpErrors,
		serverCount: mcpServerCount,
		connectedCount: mcpConnectedCount,
		isAnyConnecting,
		hasAnyError,
	} = useMcpManager();

	const { handleDispatch } = useDispatcher(mcpTools);
	const [isCommandProcessing, setIsCommandProcessing] = useState(false);

	const { fetchContext, isFetching: isRagFetching } = useRagContext(
		callTool,
		mcpConnected,
	);

	const buffer = useTextBuffer({
		initialText: "",
		viewportWidth: inputWidth,
		viewportHeight: availableTerminalHeight,
	});

	const inputState = useMemo(
		() => ({
			buffer,
			userMessages: inputHistory,
			shellModeActive,
			showEscapePrompt,
			copyModeEnabled,
			inputWidth,
			suggestionsWidth,
		}),
		[
			buffer,
			inputHistory,
			shellModeActive,
			showEscapePrompt,
			copyModeEnabled,
			inputWidth,
			suggestionsWidth,
		],
	);
	const {
		pendingItem,
		streamingState,
		isLoading,
		error,
		sendMessage,
		reset,
		clearStreamingHistory,
	} = useLlmStream(callTool, mcpTools);
	const historyManager = useHistoryManager();

	const addInfoMessage = useCallback(
		(content: string) => {
			const id = historyManager.addItem({
				type: "info",
				content,
				timestamp: Date.now(),
			});
			setTimeout(() => {
				historyManager.removeItem(id);
			}, 2000);
		},
		[historyManager],
	);

	const genMcpToolsText = useCallback(() => {
		const toolsText = mcpConnected
			? Array.from(mcpToolsByServer.entries())
					.map(([serverName, serverTools]) => {
						const toolList = serverTools
							.map(
								(t) =>
									`  • ${t.name}${t.description ? ` — ${t.description}` : ""}`,
							)
							.join("\n");
						return `[${serverName}] (${serverTools.length} tools)\n${toolList}`;
					})
					.join("\n\n")
			: "MCP 서버에 연결되지 않았습니다.";

		return `Mcp List:\n${toolsText}`;
	}, [mcpConnected, mcpToolsByServer]);

	useEffect(() => {
		void initializeFromLogger(historyStorage);
	}, [initializeFromLogger]);

	useEffect(() => {
		if (pendingItem?.isComplete) {
			historyManager.addItem({
				type: "assistant",
				content: pendingItem.content,
				timestamp: Date.now(),
			});
			reset();
		}
	}, [pendingItem, reset, historyManager]);

	// 에러 로깅
	useEffect(() => {
		if (error) {
			debugLogger.error("[AppContainer] LLM stream error:", error.message);
		}
	}, [error]);

	const handleGlobalKeypress = useCallback(
		(key: Key) => {
			// 1. Ctrl+C Handling (3-Stage)
			if (
				keyMatchers[Command.QUIT](key) ||
				keyMatchers[Command.CLEAR_INPUT](key)
			) {
				// Stage 1: Clear Input
				if (buffer.text.length > 0) {
					buffer.setText("");
					lastCtrlCPress.current = 0;
					return true;
				}

				// Stage 2: Cancel Ongoing Request
				if (isLoading || isCommandProcessing) {
					reset();
					setIsCommandProcessing(false);
					lastCtrlCPress.current = 0;

					addInfoMessage("요청이 취소되었습니다.");
					return true;
				}

				// Stage 3: Quit Program
				const now = Date.now();
				if (now - lastCtrlCPress.current < 2000) {
					process.exit(0);
				} else {
					lastCtrlCPress.current = now;
					addInfoMessage("Press Ctrl+C again to exit.");
				}
				return true;
			}

			// 2. Toggle Copy Mode (F9)
			if (keyMatchers[Command.TOGGLE_COPY_MODE](key)) {
				setCopyModeEnabled((prev) => !prev);
				addInfoMessage(
					!copyModeEnabled
						? "복사 모드가 활성화되었습니다. (마우스 드래그 가능)"
						: "복사 모드가 비활성화되었습니다. (마우스 트래킹 활성)",
				);
				return true;
			}

			return false;
		},
		[
			buffer,
			isLoading,
			isCommandProcessing,
			reset,
			copyModeEnabled,
			keyMatchers,
			addInfoMessage,
		],
	);

	useKeypress(handleGlobalKeypress, { isActive: true, priority: true });

	const handleFinalSubmit = useCallback(
		async (value: string) => {
			if (!value.trim() || isLoading) return;

			// Add to UI state session & past session recalculator
			addInput(value);

			// Save to physical file via storage utility
			void historyStorage.appendMessage(value);

			if (value.startsWith("/")) {
				// 슬래시 커맨드 → Dispatcher → MCP 도구 호출
				buffer.setText("");
				setIsCommandProcessing(true);

				try {
					const result = await handleDispatch(value, callTool);

					// 로컬 액션 처리
					if (result.content === "__CLEAR_HISTORY__") {
						historyManager.clearItems();
						clearStreamingHistory();
						addInfoMessage("대화 히스토리가 초기화되었습니다.");
						return;
					}

					if (result.content === "__LIST_TOOLS__") {
						addInfoMessage(genMcpToolsText());
						return;
					}

					if (result.type === "llm_required") {
						historyManager.addItem({
							type: "user",
							content: result.userIntent ?? value,
							timestamp: Date.now(),
						});

						void sendMessage(result.userIntent ?? value, result.content);
					} else {
						// result.type is "tool_result" | "local_action" | "unknown_command"
						if (
							(result.type as string) === "info" ||
							result.type === "unknown_command"
						) {
							addInfoMessage(result.content);
						} else {
							const historyType =
								result.type === "tool_result" ? "assistant" : "info";
							historyManager.addItem({
								type: historyType,
								content: result.content,
								timestamp: Date.now(),
							});
						}
					}
				} finally {
					setIsCommandProcessing(false);
				}
			} else {
				historyManager.addItem({
					type: "user",
					content: value,
					timestamp: Date.now(),
				});

				buffer.setText("");

				// 1. 도구 트리거 감지 (도구 이름이나 서버 이름이 포함된 경우)
				const triggeredTools: typeof mcpTools = [];
				const lowerValue = value.toLowerCase();

				for (const [serverName, serverTools] of mcpToolsByServer.entries()) {
					// 서버 이름이 언급된 경우 해당 서버의 모든 도구 활성화
					if (lowerValue.includes(serverName.toLowerCase())) {
						triggeredTools.push(...serverTools);
						continue;
					}

					// 특정 도구 이름이 언급된 경우 해당 도구만 활성화
					for (const tool of serverTools) {
						if (lowerValue.includes(tool.name.toLowerCase())) {
							triggeredTools.push(tool);
						}
					}
				}

				// 중복 제거
				const uniqueTriggered = Array.from(new Set(triggeredTools));

				// 2. Vault 도구가 트리거된 경우에만 RAG 컨텍스트 수집
				const isVaultTriggered = uniqueTriggered.some(
					(t) => t.name === "vault",
				);
				const ragContext = isVaultTriggered ? await fetchContext(value) : null;

				// 3. 트리거된 도구만 LLM에 전달
				void sendMessage(value, ragContext, uniqueTriggered);
			}
		},
		[
			addInput,
			buffer,
			handleDispatch,
			callTool,
			historyManager,
			clearStreamingHistory,
			genMcpToolsText,
			mcpToolsByServer,
			fetchContext,
			sendMessage,
			isLoading,
			addInfoMessage,
		],
	);

	return (
		<InputContext.Provider value={inputState}>
			<Box flexDirection="column" width="100%">
				{/* MCP 연결 상태 표시 — 요약된 정보 제공 */}

				<MainContent
					history={historyManager.history}
					pendingItem={pendingItem}
					streamingState={streamingState}
					isRagFetching={isRagFetching}
					isCommandProcessing={isCommandProcessing}
					width={mainAreaWidth}
				/>

				{/* 에러 배너: history에 추가하지 않고 별도 UI로 표시 */}
				{error && (
					<Box paddingX={1} marginBottom={1}>
						<Text color="red" bold>
							✖ {error.message}
						</Text>
					</Box>
				)}
			</Box>

			<Box
				paddingX={1}
				marginTop={1}
				flexDirection={"column"}
				gap={0}
				width={"100%"}
				borderTop={true}
				borderBottom={false}
				borderLeft={false}
				borderRight={false}
				borderTopColor={theme.border.default}
				borderStyle={"bold"}
			>
				<SystemInfoSummaryBox>
					<MCPServers
						isConnected={mcpConnected}
						connections={mcpConnections}
						serverCount={mcpServerCount}
						connectedCount={mcpConnectedCount}
						errors={mcpErrors}
					/>
				</SystemInfoSummaryBox>

				<InputPrompt
					onSubmit={handleFinalSubmit}
					focus={streamingState === "idle" && mcpConnected}
					placeholder={
						isAnyConnecting
							? ` MCP 서버 연결 중... (${mcpConnectedCount}/${mcpServerCount})`
							: hasAnyError && !mcpConnected
								? " MCP 연결에 실패했습니다"
								: " Type your message..."
					}
				/>
			</Box>
		</InputContext.Provider>
	);
};
