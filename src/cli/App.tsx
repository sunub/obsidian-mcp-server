import { readFileSync } from "node:fs";
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
import type { McpToolInfo } from "@cli/services/McpClientService.js";
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
import { useSlashCommand } from "./hooks/useSlashCommand.js";
import { ThinkingIndicator } from "./ui/ThinkingIndicator.js";
import { disableMouseEvents } from "./utils/terminal.js";

const readOffloadedFileTool: McpToolInfo = {
	name: "read_offloaded_file",
	description:
		"Reads the full content of an offloaded temporary file. Use this tool when you need to inspect or analyze the full text of a large pasted content or document that was offloaded to a file path.",
	inputSchema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description:
					"The absolute path of the temporary file to read (e.g. /Users/.../temp/paste_xxx.md)",
			},
		},
		required: ["path"],
	},
};

export const App = ({ mcp }: { mcp: UseMcpManagerReturn }) => {
	const [shellModeActive] = useState(false);
	const [copyModeEnabled, setCopyModeEnabled] = useState(false);
	const [showEscapePrompt] = useState(false);

	const lastCtrlCPress = useRef<number>(0);
	const isSubmittingRef = useRef<boolean>(false);
	const currentHistoryIdRef = useRef<number | null>(null);
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

	const historyManager = useHistoryManager();

	const wrappedCallTool = useCallback(
		async (name: string, args: Record<string, unknown>) => {
			if (name === "read_offloaded_file") {
				const filePath = args["path"];
				if (typeof filePath !== "string" || !filePath) {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text: "Error: 'path' argument is required and must be a string.",
							},
						],
					};
				}
				try {
					const activeHistoryIds = historyManager.history.map((h) => h.id);
					const currentHistoryId = currentHistoryIdRef.current ?? undefined;
					if (
						!InputOffloadService.isValidOffloadedPath(
							filePath,
							activeHistoryIds,
							currentHistoryId,
						)
					) {
						return {
							isError: true,
							content: [
								{
									type: "text",
									text: "Error: Access denied. The offloaded content has expired or its matching placeholder block has been tampered with.",
								},
							],
						};
					}
					const content = readFileSync(filePath, "utf-8");
					return {
						isError: false,
						content: [{ type: "text", text: content }],
					};
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					return {
						isError: true,
						content: [
							{
								type: "text",
								text: `Error reading file: ${errorMessage}`,
							},
						],
					};
				}
			}
			return callTool(name, args);
		},
		[callTool, historyManager],
	);

	const { fetchContext, isFetching: isRagFetching } = useRagContext(
		wrappedCallTool,
		mcpConnected,
	);

	const combinedTools = useMemo(() => {
		return [...mcpTools, readOffloadedFileTool];
	}, [mcpTools]);

	const {
		pendingItem,
		streamingState,
		isLoading,
		error,
		submitQuery,
		abortCurrentStream,
		clearStreamingHistory,
	} = useLlmStream({
		addItem: historyManager.addItem,
		callTool: wrappedCallTool,
		availableTools: combinedTools,
	});

	const { transientMessage, showTransientMessage } = useTransientMessage();

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

	const { executeCommand } = useSlashCommand({
		historyManager,
		clearStreamingHistory,
		callTool: wrappedCallTool,
		handleDispatch,
		genMcpToolsText,
		addInfoMessage,
		setIsCommandProcessing,
	});

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

	useEffect(() => {
		void initializeFromLogger(historyStorage);
	}, [initializeFromLogger]);

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
			if (
				keyMatchers[Command.QUIT](key) ||
				keyMatchers[Command.CLEAR_INPUT](key)
			) {
				if (buffer.text.length > 0) {
					buffer.setText("");
					lastCtrlCPress.current = 0;
					return true;
				}

				if (isLoading || isCommandProcessing) {
					abortCurrentStream();
					setIsCommandProcessing(false);
					lastCtrlCPress.current = 0;

					// Helper for info messages
					const id = historyManager.addItem({
						type: "info",
						content: "요청이 취소되었습니다.",
						timestamp: Date.now(),
					});
					setTimeout(() => historyManager.removeItem(id), 2000);
					return true;
				}

				const now = Date.now();
				if (now - lastCtrlCPress.current < 1000) {
					cleanupManager.gracefulShutdown("user-quit (double-tap)");
				} else {
					lastCtrlCPress.current = now;
					const id = historyManager.addItem({
						type: "info",
						content: "한 번 더 누르면 종료됩니다.",
						timestamp: Date.now(),
					});
					setTimeout(() => historyManager.removeItem(id), 2000);
					abortCurrentStream();
				}
				return true;
			}

			if (keyMatchers[Command.TOGGLE_COPY_MODE](key)) {
				setCopyModeEnabled((prev) => !prev);
				const id = historyManager.addItem({
					type: "info",
					content: !copyModeEnabled
						? "복사 모드가 활성화되었습니다. (마우스 드래그 가능)"
						: "복사 모드가 비활성화되었습니다. (마우스 트래킹 활성)",
					timestamp: Date.now(),
				});
				setTimeout(() => historyManager.removeItem(id), 2000);
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
			historyManager,
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
				currentHistoryIdRef.current = tempHistoryId;
				const optimizedPrompt = await InputOffloadService.processPastedContent(
					value,
					submittedPastedContent,
					tempHistoryId,
				);

				addInput(value);
				void historyStorage.appendMessage(value);

				buffer.setText("");

				if (value.startsWith("/")) {
					const result = await executeCommand(value, tempHistoryId);
					if (result.type === "llm_required") {
						const triggeredTools: typeof mcpTools = [];
						const lowerIntent = result.userIntent.toLowerCase();

						for (const [
							serverName,
							serverTools,
						] of mcpToolsByServer.entries()) {
							if (lowerIntent.includes(serverName.toLowerCase())) {
								triggeredTools.push(...serverTools);
								continue;
							}
							for (const tool of serverTools) {
								if (lowerIntent.includes(tool.name.toLowerCase())) {
									triggeredTools.push(tool);
								}
							}
						}

						const uniqueTriggered = Array.from(new Set(triggeredTools));
						uniqueTriggered.push(readOffloadedFileTool);
						const isVaultTriggered = uniqueTriggered.some(
							(t) => t.name === "vault",
						);
						const ragContext = isVaultTriggered
							? await fetchContext(result.userIntent)
							: null;

						await submitQuery(result.userIntent, {
							overrideTools: uniqueTriggered,
							ragContext,
							timestamp: tempHistoryId,
						});
					}
				} else {
					const maxTurns = 20;
					if (historyManager.history.length >= maxTurns) {
						historyManager.pruneAndCompressHistory(maxTurns);
						const currentIds = historyManager.history.map((h) => h.id);
						InputOffloadService.prune(currentIds);
					}

					const triggeredTools: typeof mcpTools = [];
					const lowerValue = value.toLowerCase();

					for (const [serverName, serverTools] of mcpToolsByServer.entries()) {
						if (lowerValue.includes(serverName.toLowerCase())) {
							triggeredTools.push(...serverTools);
							continue;
						}
						for (const tool of serverTools) {
							if (lowerValue.includes(tool.name.toLowerCase())) {
								triggeredTools.push(tool);
							}
						}
					}

					const uniqueTriggered = Array.from(new Set(triggeredTools));
					uniqueTriggered.push(readOffloadedFileTool);
					const isVaultTriggered = uniqueTriggered.some(
						(t) => t.name === "vault",
					);
					const ragContext = isVaultTriggered
						? await fetchContext(value)
						: null;

					await submitQuery(optimizedPrompt, {
						overrideTools: uniqueTriggered,
						ragContext,
						timestamp: tempHistoryId,
					});
				}
			} finally {
				isSubmittingRef.current = false;
			}
		},
		[
			addInput,
			buffer,
			executeCommand,
			historyManager,
			mcpToolsByServer,
			fetchContext,
			submitQuery,
			isLoading,
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
