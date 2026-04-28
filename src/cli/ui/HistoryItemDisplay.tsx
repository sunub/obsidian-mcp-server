import type { ContentRenderer, HistoryItem } from "@cli/types.js";
import { Box, Text } from "ink";
import type React from "react";

type HISTORY_DISPLAY_TYPE = "user" | "assistant" | "error" | "info";

const renderPlainText: ContentRenderer = (content: string, _width: number) =>
	content;

interface HistoryItemDisplayProps {
	item: HistoryItem;
	width: number;
	contentRenderer?: ContentRenderer;
}

const LABEL_MAP: Record<
	HistoryItem["type"],
	{
		type: HISTORY_DISPLAY_TYPE;
		label: string;
		fontColor: string;
		highlightColor: string;
	}
> = {
	user: {
		type: "user",
		label: "▶ You",
		fontColor: "#F1F5F9",
		highlightColor: "#F1F5F9",
	},
	assistant: {
		type: "assistant",
		label: "◀ Assistant",
		fontColor: "white",
		highlightColor: "magenta",
	},
	error: {
		type: "error",
		label: "✖ Error",
		highlightColor: "red",
		fontColor: "white",
	},
	info: {
		type: "info",
		label: "ℹ Info",
		highlightColor: "yellow",
		fontColor: "white",
	},
};

export const HistoryItemDisplay: React.FC<HistoryItemDisplayProps> = ({
	item,
	width,
	contentRenderer = renderPlainText,
}) => {
	const { label, fontColor, highlightColor, type } = LABEL_MAP[item.type];

	return (
		<Box
			width={width}
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			marginTop={1}
			marginBottom={1}
		>
			{type === "user" ? (
				<>
					<Text bold color={highlightColor}>
						{label}
					</Text>
					<Text color={fontColor}>{contentRenderer(item.content, width)}</Text>
				</>
			) : (
				<>
					<Box paddingBottom={1}>
						<Text bold color={highlightColor}>
							{label}
						</Text>
					</Box>
					<Text color={fontColor}>{contentRenderer(item.content, width)}</Text>
				</>
			)}
		</Box>
	);
};
