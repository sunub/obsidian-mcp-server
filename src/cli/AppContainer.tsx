import { Box, Text } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InputContext } from "./context/InputContext.js";
import { KeypressProvider } from "./context/KeypressContext.js";
import { useDispatcher } from "./hooks/useDispatcher.js";
import { useInputHistoryStore } from "./hooks/useInputHistory.js";
import { useLlmStream } from "./hooks/useLlmStream/index.js";
import { useMcpManager } from "./hooks/useMcpManager.js";
import { useRagContext } from "./hooks/useRagContext.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useTextBuffer } from "./key/text-buffer.js";
import type { HistoryItem } from "./types.js";
import { ConnectionStatus } from "./ui/ConnectionStatus.js";
import { calculatePromptWidths, InputPrompt } from "./ui/InputPrompt.js";
import { MainContent } from "./ui/MainContent.js";
import { debugLogger } from "./utils/debugLogger.js";
import { historyStorage } from "./utils/historyStorage.js";

export const AppContainer = () => {
	const [shellModeActive] = useState(false);
	const [copyModeEnabled] = useState(false);
	const [showEscapePrompt] = useState(false);

	const { columns: terminalWidth, rows: terminalHeight } = useTerminalSize();
	const mainAreaWidth = terminalWidth;
	const { inputWidth, suggestionsWidth } = useMemo(() => {
		const { inputWidth, suggestionsWidth } =
			calculatePromptWidths(mainAreaWidth);
		return { inputWidth, suggestionsWidth };
	}, [mainAreaWidth]);

	const availableTerminalHeight = Math.max(0, terminalHeight - 2);

	const { inputHistory, addInput, initializeFromLogger } =
		useInputHistoryStore();

	useEffect(() => {
		void initializeFromLogger(historyStorage);
	}, [initializeFromLogger]);

	// MCP Manager — 다중 MCP 서버 연결 관리
	const {
		isConnected: mcpConnected,
		connections: mcpConnections,
		tools: mcpTools,
		toolsByServer: mcpToolsByServer,
		callTool,
		errors: mcpErrors,
		serverCount: mcpServerCount,
		connectedCount: mcpConnectedCount,
	} = useMcpManager();

	const { handleDispatch } = useDispatcher(mcpTools);

	const { fetchContext } = useRagContext(callTool, mcpConnected);

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
	} = useLlmStream(callTool, mcpTools);

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
				if (result.type === "llm_required") {
					// LLM 지시문 페이로드 → 사용자 입력을 히스토리에 표시 후 LLM으로 파이프
					setHistory((prev) => [
						...prev,
						{
							id: nextIdRef.current++,
							type: "user",
							content: result.userIntent ?? value,
							timestamp: Date.now(),
						},
					]);
					// 도구 결과(instructions + content_preview)를 RAG 컨텍스트처럼 LLM에 주입
					void sendMessage(result.userIntent ?? value, result.content);
				} else {
					setHistory((prev) => [
						...prev,
						{
							id: nextIdRef.current++,
							type: result.type === "unknown_command" ? "error" : "info",
							content: result.content,
							timestamp: Date.now(),
						},
					]);
				}
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
			mcpToolsByServer,
			sendMessage,
		],
	);

	// 전체 서버 연결 중 여부 판별
	const isAnyConnecting = Array.from(mcpConnections.values()).some(
		(info) => info.state === "connecting",
	);
	const hasAnyError = mcpErrors.size > 0;

	return (
		<KeypressProvider>
			<InputContext.Provider value={inputState}>
				<Box flexDirection="column" width="100%">
					{/* MCP 연결 상태 표시 — 모두 연결되기 전까지 노출 */}
					{!mcpConnected && (
						<ConnectionStatus connections={mcpConnections} errors={mcpErrors} />
					)}

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
					{hasAnyError && !error && (
						<Box paddingX={1} marginBottom={1} flexDirection="column">
							{Array.from(mcpErrors.entries()).map(
								([serverName, serverError]) => (
									<Text key={serverName} color="yellow" bold>
										⚠ MCP [{serverName}]: {serverError.message}
									</Text>
								),
							)}
						</Box>
					)}
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
		</KeypressProvider>
	);
};
