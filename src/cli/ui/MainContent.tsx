import type React from "react";
import { Box, Static, Text } from "ink";
import type { HistoryItem, PendingItem, StreamingState } from "../types.js";
import { HistoryItemDisplay } from "./HistoryItemDisplay.js";
import { ThinkingIndicator } from "./ThinkingIndicator.js";
import { HelpCommands } from "./HelpCommands.js";
import { HELP_COMMAND_MARKER } from "../constants.js";

interface MainContentProps {
	history: HistoryItem[];
	pendingItem: PendingItem | null;
	streamingState: StreamingState;
	width: number;
}

export const MainContent: React.FC<MainContentProps> = ({
	history,
	pendingItem,
	streamingState,
	width,
}) => {
	return (
		<>
			{/* 과거 기록: <Static>에 가두어 한 번만 렌더링 */}
			<Static items={history}>
				{(item: HistoryItem) => {
					if (item.content === HELP_COMMAND_MARKER) {
						return <HelpCommands key={item.id} width={width} />;
					}
					return <HistoryItemDisplay key={item.id} item={item} width={width} />;
				}}
			</Static>

			{/* Thinking 인디케이터: 첫 번째 청크 도착 전 */}
			{streamingState === "thinking" && <ThinkingIndicator />}

			{/* 현재 스트리밍 중인 응답: <Static> 바깥에서 활발히 리렌더 */}
			{pendingItem && pendingItem.content.length > 0 && (
				<Box flexDirection="column" width={width} paddingX={1} marginBottom={1}>
					<Text color="cyan" bold>
						◀ Assistant
					</Text>
					<Text wrap="wrap">{pendingItem.content}</Text>
				</Box>
			)}
		</>
	);
};
