import { PASTED_TEXT_PLACEHOLDER_REGEX } from "@cli/key/textBuffer/index.js";
import { InputOffloadService } from "@cli/services/InputOffloadService.js";
import type { ContentRenderer, HistoryItem } from "@cli/types.js";
import chalk from "chalk";
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

	const renderContentWithOffload = (content: string) => {
		const rendered = contentRenderer(content, width);
		if (typeof rendered !== "string") return rendered;

		const parts = [];
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		// Reset regex state
		PASTED_TEXT_PLACEHOLDER_REGEX.lastIndex = 0;

		match = PASTED_TEXT_PLACEHOLDER_REGEX.exec(rendered);
		while (match !== null) {
			const placeholder = match[0];
			const isOffloaded = InputOffloadService.isOffloaded(placeholder, item.id);

			// Add text before placeholder
			if (match.index > lastIndex) {
				parts.push(rendered.substring(lastIndex, match.index));
			}

			if (isOffloaded) {
				const filePath = InputOffloadService.getOffloadedPath(
					placeholder,
					item.id,
				);
				parts.push(
					chalk.cyan(
						` [📦 오프로딩 완료: ${placeholder} -> ${filePath || "임시 파일"}] `,
					),
				);
			} else {
				parts.push(chalk.dim(placeholder));
			}

			lastIndex = match.index + placeholder.length;
			match = PASTED_TEXT_PLACEHOLDER_REGEX.exec(rendered);
		}

		if (lastIndex < rendered.length) {
			parts.push(rendered.substring(lastIndex));
		}

		return parts.length > 0 ? parts.join("") : rendered;
	};

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
					<Text color={fontColor}>
						{renderContentWithOffload(item.content)}
					</Text>
				</>
			) : (
				<>
					<Box paddingBottom={1}>
						<Text bold color={highlightColor}>
							{label}
						</Text>
					</Box>
					<Text color={fontColor}>
						{renderContentWithOffload(item.content)}
					</Text>
				</>
			)}
		</Box>
	);
};
