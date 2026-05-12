import { InputContext } from "@cli/context/InputContext.js";
import { UIStateContext } from "@cli/context/UIStateContext.js";
import { useDispatcher } from "@cli/hooks/useDispatcher.js";
import { useHistoryManager } from "@cli/hooks/useHistoryManager.js";
import { useInputHistoryStore } from "@cli/hooks/useInputHistory.js";
import { useKeyMatchers } from "@cli/hooks/useKeyMatchers.js";
import { type Key, useKeypress } from "@cli/hooks/useKeypress.js";
import { useLlmStream } from "@cli/hooks/useLlmStream/index.js";
import type { UseMcpManagerReturn } from "@cli/hooks/useMcpManager.js";
import { useRagContext } from "@cli/hooks/useRagContext.js";
import { useTerminalSize } from "@cli/hooks/useTerminalSize.js";
import { useTransientMessage } from "@cli/hooks/useTransientMessage.js";
import { Command } from "@cli/key/keyMatchers.js";
import { useTextBuffer } from "@cli/key/textBuffer/index.js";
import { InputOffloadService } from "@cli/services/InputOffloadService.js";
import {
	calculatePromptWidths,
	InputPrompt,
	type InputSubmissionContext,
} from "@cli/ui/InputPrompt.js";
import { MainContent } from "@cli/ui/MainContent.js";
import { MCPServers } from "@cli/ui/MCPServers.js";
import { SystemInfoSummaryBox } from "@cli/ui/SystemInfoSummaryBox.js";
import {
	AppEvent,
	appEvents,
	type TransientMessagePayload,
} from "@cli/utils/events.js";
import { historyStorage } from "@cli/utils/historyStorage.js";
import { Box } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debugLogger } from "@/shared/index.js";
import { cleanupManager } from "@/utils/cleanup.js";
import { ThinkingIndicator } from "./ui/ThinkingIndicator.js";
import { disableMouseEvents } from "./utils/terminal.js";

export const App = ({ mcp }: { mcp: UseMcpManagerReturn }) => {
	const [shellModeActive] = useState(false);
	const [copyModeEnabled, setCopyModeEnabled] = useState(false);
	const [showEscapePrompt] = useState(false);

	const lastCtrlCPress = useRef<number>(0);
	const isSubmittingRef = useRef<boolean>(false);
	const keyMatchers = useKeyMatchers();

	const { columns: terminalWidth, rows: terminalHeight } = useTerminalSize();

	useEffect(() => {
		disableMouseEvents();
	}, []);

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
	} = mcp;

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
		abortCurrentStream,
		clearStreamingHistory,
	} = useLlmStream(callTool, mcpTools);
	const { transientMessage, showTransientMessage } = useTransientMessage();
	const isBusy =
		isRagFetching ||
		isCommandProcessing ||
		streamingState === "thinking" ||
		streamingState === "executing";

	useEffect(() => {
		cleanupManager.registerSoftAbort(abortCurrentStream);
		cleanupManager.register("offload-files", () => {
			InputOffloadService.cleanupAll();
		});
	}, [abortCurrentStream]);

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
			abortCurrentStream();

			// Prune history to prevent OOM
			historyManager.pruneAndCompressHistory(20);
		}
	}, [pendingItem, abortCurrentStream, historyManager]);

	// 에러 로깅
	useEffect(() => {
		if (error) {
			debugLogger.error("[AppContainer] LLM stream error:", error.message);
		}
	}, [error]);

	useEffect(() => {
		const handleTransientMessage = (payload: TransientMessagePayload) => {
			showTransientMessage({ text: payload.message, type: payload.type });
		};

		appEvents.on(AppEvent.TransientMessage, handleTransientMessage);

		return () => {
			appEvents.off(AppEvent.TransientMessage, handleTransientMessage);
		};
	}, [showTransientMessage]);

	const handleGlobalKeypress = useCallback(
		(key: Key) => {
			// 1. Ctrl+C Handling (Consistent with CleanupManager)
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

				// Stage 2: Soft Abort
				if (isLoading || isCommandProcessing) {
					abortCurrentStream();
					setIsCommandProcessing(false);
					lastCtrlCPress.current = 0;

					addInfoMessage("요청이 취소되었습니다.");
					return true;
				}

				// Stage 3: Quit Program
				const now = Date.now();
				if (now - lastCtrlCPress.current < 1000) {
					cleanupManager.gracefulShutdown("user-quit (double-tap)");
				} else {
					lastCtrlCPress.current = now;
					addInfoMessage("한 번 더 누르면 종료됩니다.");
					abortCurrentStream();
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
			copyModeEnabled,
			keyMatchers,
			addInfoMessage,
			abortCurrentStream,
		],
	);
	useKeypress(handleGlobalKeypress, { isActive: true, priority: true });

	const handleFinalSubmit = useCallback(
		async (value: string, submissionContext?: InputSubmissionContext) => {
			if (!value.trim() || isLoading || isSubmittingRef.current) {
				return;
			}

			isSubmittingRef.current = true;

			try {
				const submittedPastedContent =
					submissionContext?.pastedContent ?? buffer.pastedContent;

				const tempHistoryId = Date.now();
				const optimizedPrompt = await InputOffloadService.processPastedContent(
					value,
					submittedPastedContent,
					tempHistoryId,
				);

				addInput(value);

				void historyStorage.appendMessage(value);

				if (value.startsWith("/")) {
					buffer.setText("");
					setIsCommandProcessing(true);

					try {
						const result = await handleDispatch(value, callTool);

						if (result.content === "__CLEAR_HISTORY__") {
							historyManager.clearItems();
							clearStreamingHistory();
							InputOffloadService.cleanupAll(); // Clear all offloaded files
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
								timestamp: tempHistoryId,
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
									timestamp: tempHistoryId,
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
						timestamp: tempHistoryId,
					});

					buffer.setText("");

					// Prune check for GC
					const maxTurns = 20;
					if (historyManager.history.length >= maxTurns) {
						historyManager.pruneAndCompressHistory(maxTurns);
						const currentIds = historyManager.history.map((h) => h.id);
						InputOffloadService.prune(currentIds);
					}

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
					const ragContext = isVaultTriggered
						? await fetchContext(value)
						: null;

					// 3. 트리거된 도구만 LLM에 전달
					void sendMessage(optimizedPrompt, ragContext, uniqueTriggered);
				}
			} finally {
				isSubmittingRef.current = false;
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

	const isInputActive = streamingState === "idle" && mcpConnected;
	const uiState = useMemo(
		() => ({
			history: historyManager.history,
			streamingState,
			terminalWidth,
			terminalHeight,
			isInputActive,
			transientMessage,
		}),
		[
			historyManager.history,
			streamingState,
			terminalWidth,
			terminalHeight,
			isInputActive,
			transientMessage,
		],
	);

	return (
		<UIStateContext.Provider value={uiState}>
			<InputContext.Provider value={inputState}>
				<MainContent
					history={historyManager.history}
					pendingItem={pendingItem}
					streamingState={streamingState}
					isRagFetching={isRagFetching}
					isCommandProcessing={isCommandProcessing}
					width={mainAreaWidth}
				/>
				<Box
					paddingX={1}
					marginTop={1}
					flexDirection="column"
					gap={0}
					width="100%"
				>
					<SystemInfoSummaryBox>
						<ThinkingIndicator isBusy={isBusy} />
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
						focus={isInputActive}
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
		</UIStateContext.Provider>
	);
};
