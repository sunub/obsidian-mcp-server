import { Box, Static, Text } from "ink";
import type React from "react";
import { HELP_COMMAND_MARKER } from "../constants.js";
import type { HistoryItem, PendingItem, StreamingState } from "../types.js";
import { HelpCommands } from "./HelpCommands.js";
import { HistoryItemDisplay } from "./HistoryItemDisplay.js";
import { ThinkingIndicator } from "./ThinkingIndicator.js";

interface MainContentProps {
	history: HistoryItem[];
	pendingItem: PendingItem | null;
	streamingState: StreamingState;
	width: number;
}

const MAX_THINKING_LINES = 6;

function ThinkingBlock({
	content,
	isActive,
}: {
	content: string;
	isActive: boolean;
}) {
	const lines = content.split("\n").filter((l) => l.trim());
	const displayLines = isActive ? lines : lines.slice(0, MAX_THINKING_LINES);
	const truncated = !isActive && lines.length > MAX_THINKING_LINES;

	return (
		<Box
			flexDirection="column"
			borderStyle="single"
			borderColor="gray"
			paddingX={1}
			marginBottom={isActive ? 0 : 1}
		>
			<Text color="gray" dimColor bold>
				💭 {isActive ? "thinking..." : `thought (${lines.length} lines)`}
			</Text>
			{displayLines.map((line, i) => (
				<Text
					// biome-ignore lint/suspicious/noArrayIndexKey: static display lines
					key={i}
					color="gray"
					dimColor
					wrap="wrap"
				>
					{line}
				</Text>
			))}
			{truncated && (
				<Text color="gray" dimColor>
					... ({lines.length - MAX_THINKING_LINES} more lines)
				</Text>
			)}
		</Box>
	);
}

export const MainContent: React.FC<MainContentProps> = ({
	history,
	pendingItem,
	streamingState,
	width,
}) => {
	return (
		<>
			<Static items={history}>
				{(item: HistoryItem) => {
					if (item.content === HELP_COMMAND_MARKER) {
						return <HelpCommands key={item.id} width={width} />;
					}
					return <HistoryItemDisplay key={item.id} item={item} width={width} />;
				}}
			</Static>

			{streamingState === "thinking" && <ThinkingIndicator />}

			{pendingItem && (
				<Box flexDirection="column" width={width} paddingX={1} marginBottom={1}>
					{pendingItem.thinkingContent && (
						<ThinkingBlock
							content={pendingItem.thinkingContent}
							isActive={pendingItem.isThinking === true}
						/>
					)}

					{pendingItem.content.length > 0 && (
						<>
							<Text color="cyan" bold>
								◀ Assistant
							</Text>
							<Text wrap="wrap">{pendingItem.content}</Text>
						</>
					)}
				</Box>
			)}
		</>
	);
};
