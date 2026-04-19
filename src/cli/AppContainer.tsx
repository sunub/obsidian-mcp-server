import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Box, Text } from "ink";
import { calculatePromptWidths, InputPrompt } from "./ui/InputPrompt.js";
import { KeypressProvider } from "./context/KeypressContext.js";
import { InputContext } from "./context/InputContext.js";
import { useTextBuffer } from "./key/text-buffer.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useInputHistoryStore } from "./hooks/useInputHistory.js";
import { historyStorage } from "./utils/historyStorage.js";
import { useDispatcher } from "./hooks/useDispatcher.js";
import { useLlmStream } from "./hooks/useLlmStream.js";
import { useMcpClient } from "./hooks/useMcpClient.js";
import { useRagContext } from "./hooks/useRagContext.js";
import { MainContent } from "./ui/MainContent.js";
import { debugLogger } from "./utils/debugLogger.js";
import type { HistoryItem } from "./types.js";

export const AppContainer = () => {
	const [shellModeActive] = useState(false);
	const [copyModeEnabled] = useState(false);
	const [showEscapePrompt] = useState(false);

	// Layout context
	const { columns: terminalWidth, rows: terminalHeight } = useTerminalSize();
	const mainAreaWidth = terminalWidth;
	const { inputWidth, suggestionsWidth } = useMemo(() => {
		const { inputWidth, suggestionsWidth } =
			calculatePromptWidths(mainAreaWidth);
		return { inputWidth, suggestionsWidth };
	}, [mainAreaWidth]);

	const availableTerminalHeight = Math.max(0, terminalHeight - 2);

	// History & Storage
	const { inputHistory, addInput, initializeFromLogger } =
		useInputHistoryStore();

	useEffect(() => {
		// Initialize history from our 24h file storage on mount
		void initializeFromLogger(historyStorage);
	}, [initializeFromLogger]);

	// Command dispatcher
	const { handleDispatch } = useDispatcher();

	// MCP Client — Obsidian Vault 연결
	const {
		isConnected: mcpConnected,
		tools: mcpTools,
		callTool,
		error: mcpError,
	} = useMcpClient();

	// RAG Context — Vault 기반 컨텍스트 조회
	const { fetchContext } = useRagContext(callTool, mcpConnected);

	// Text buffer
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

	// --- Phase 4~6: history + pendingItem 기반 상태 관리 ---
	const [history, setHistory] = useState<HistoryItem[]>([]);
	const nextIdRef = useRef(1);
	const {
		pendingItem,
		streamingState,
		isLoading,
		error,
		sendMessage,
		reset,
		clearHistory,
	} = useLlmStream();

	// 이관 Effect: 스트림 완료 → history로 이동
	useEffect(() => {
		if (pendingItem?.isComplete) {
			setHistory((prev) => [
				...prev,
				{
					id: nextIdRef.current++,
					type: "assistant",
					content: pendingItem.content,
					timestamp: Date.now(),
				},
			]);
			reset();
		}
	}, [pendingItem, reset]);

	// 에러 로깅
	useEffect(() => {
		if (error) {
			debugLogger.error("[AppContainer] LLM stream error:", error.message);
		}
	}, [error]);

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

				const result = await handleDispatch(value, callTool);

				// 로컬 액션 처리
				if (result.content === "__CLEAR_HISTORY__") {
					setHistory([]);
					clearHistory();
					setHistory((prev) => [
						...prev,
						{
							id: nextIdRef.current++,
							type: "info",
							content: "대화 히스토리가 초기화되었습니다.",
							timestamp: Date.now(),
						},
					]);
					return;
				}

				if (result.content === "__LIST_TOOLS__") {
					const toolsText = mcpConnected
						? mcpTools
								.map(
									(t) =>
										`  • ${t.name}${t.description ? ` — ${t.description}` : ""}`,
								)
								.join("\n")
						: "MCP 서버에 연결되지 않았습니다.";
					setHistory((prev) => [
						...prev,
						{
							id: nextIdRef.current++,
							type: "info",
							content: `사용 가능한 MCP 도구:\n${toolsText}`,
							timestamp: Date.now(),
						},
					]);
					return;
				}

				// 도구 결과 또는 일반 응답을 히스토리에 추가
				setHistory((prev) => [
					...prev,
					{
						id: nextIdRef.current++,
						type: result.type === "unknown_command" ? "error" : "info",
						content: result.content,
						timestamp: Date.now(),
					},
				]);
			} else {
				// 일반 텍스트 → RAG 컨텍스트 조회 → LLM 스트리밍
				setHistory((prev) => [
					...prev,
					{
						id: nextIdRef.current++,
						type: "user",
						content: value,
						timestamp: Date.now(),
					},
				]);
				// 입력창 즉시 초기화 (Phase 6 피드백 루프)
				buffer.setText("");

				// RAG 컨텍스트 조회 (MCP 연결 시에만)
				const ragContext = await fetchContext(value);

				void sendMessage(value, ragContext);
			}
		},
		[
			addInput,
			buffer,
			callTool,
			clearHistory,
			fetchContext,
			handleDispatch,
			isLoading,
			mcpConnected,
			mcpTools,
			sendMessage,
		],
	);

	return (
		<KeypressProvider>
			<InputContext.Provider value={inputState}>
				<Box flexDirection="column" width="100%">
					{/* MCP 연결 상태 표시 */}
					{/* <ConnectionStatus */}
					{/* 	connectionState={mcpConnectionState} */}
					{/* 	toolCount={mcpTools.length} */}
					{/* /> */}

					<MainContent
						history={history}
						pendingItem={pendingItem}
						streamingState={streamingState}
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
					{mcpError && !error && (
						<Box paddingX={1} marginBottom={1}>
							<Text color="yellow" bold>
								⚠ MCP: {mcpError.message}
							</Text>
						</Box>
					)}
					<InputPrompt
						onSubmit={handleFinalSubmit}
						focus={streamingState === "idle"}
					/>
				</Box>
			</InputContext.Provider>
		</KeypressProvider>
	);
};
