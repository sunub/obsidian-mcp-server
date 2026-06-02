import { InputOffloadService } from "@cli/services/InputOffloadService.js";
import type { CallToolFn, DispatchResult } from "@cli/types.js";
import { useCallback } from "react";
import { cleanupManager } from "@/utils/cleanup.js";
import type { useHistoryManager } from "./useHistoryManager.js";

export interface SlashCommandOptions {
	historyManager: ReturnType<typeof useHistoryManager>;
	clearStreamingHistory: () => void;
	callTool: CallToolFn;
	handleDispatch: (
		value: string,
		callTool: CallToolFn,
	) => Promise<DispatchResult>;
	genMcpToolsText: () => string;
	addInfoMessage: (content: string) => void;
	setIsCommandProcessing: (val: boolean) => void;
}

export const useSlashCommand = ({
	historyManager,
	clearStreamingHistory,
	callTool,
	handleDispatch,
	genMcpToolsText,
	addInfoMessage,
	setIsCommandProcessing,
}: SlashCommandOptions) => {
	const executeCommand = useCallback(
		async (value: string, tempHistoryId: number) => {
			setIsCommandProcessing(true);
			try {
				const result = await handleDispatch(value, callTool);
				if (result.content === "__EXIT__") {
					cleanupManager.gracefulShutdown("user-command-exit");
					return { type: "local_action" as const };
				}

				if (result.content === "__CLEAR_HISTORY__") {
					historyManager.clearItems();
					clearStreamingHistory();
					InputOffloadService.cleanupAll();
					addInfoMessage("대화 히스토리가 초기화되었습니다.");
					return { type: "local_action" as const };
				}

				if (result.content === "__LIST_TOOLS__") {
					addInfoMessage(genMcpToolsText());
					return { type: "local_action" as const };
				}

				if (result.type === "llm_required") {
					return {
						type: "llm_required" as const,
						userIntent: result.userIntent ?? value,
						content: result.content,
					};
				} else {
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
					return { type: "local_action" as const };
				}
			} finally {
				setIsCommandProcessing(false);
			}
		},
		[
			callTool,
			handleDispatch,
			historyManager,
			clearStreamingHistory,
			genMcpToolsText,
			addInfoMessage,
			setIsCommandProcessing,
		],
	);

	return { executeCommand };
};
