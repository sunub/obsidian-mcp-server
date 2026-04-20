import { useCallback, useRef } from "react";
import { Box, Text } from "ink";
import chalk from "chalk";

import { theme } from "../theme/semantic-colors.js";
import { useInputHistory } from "../hooks/useInputHistory.js";
import { useKeypress, type Key } from "../hooks/useKeypress.js";
import { Command } from "../key/keyMatchers.js";
import { useKeyMatchers } from "../hooks/useKeyMatchers.js";
import { useInputState } from "../context/InputContext.js";
import { cpLen, cpSlice } from "../utils/textUtil.js";

export interface InputPromptProps {
	onSubmit: (value: string) => void;
	placeholder?: string;
	focus?: boolean;
}

export const calculatePromptWidths = (mainContentWidth: number) => {
	const FRAME_PADDING_AND_BORDER = 4; // Border (2) + padding (2)
	const PROMPT_PREFIX_WIDTH = 2; // '> ' or '! '

	const FRAME_OVERHEAD = FRAME_PADDING_AND_BORDER + PROMPT_PREFIX_WIDTH;
	const suggestionsWidth = Math.max(20, mainContentWidth);

	return {
		inputWidth: Math.max(mainContentWidth - FRAME_OVERHEAD, 1),
		containerWidth: mainContentWidth,
		suggestionsWidth,
		frameOverhead: FRAME_OVERHEAD,
	} as const;
};

export const InputPrompt: React.FC<InputPromptProps> = ({
	onSubmit,
	placeholder = " Type your message...",
	focus = true,
}) => {
	const { buffer, userMessages } = useInputState();
	const keyMatchers = useKeyMatchers();
	const innerBoxRef = useRef(null);

	const handleSubmitAndClear = useCallback(
		(submittedValue: string) => {
			buffer.setText("");
			onSubmit(submittedValue);
		},
		[buffer, onSubmit],
	);

	const customSetText = useCallback(
		(newText: string, cursorPosition?: "start" | "end" | number) => {
			buffer.setText(newText, cursorPosition);
		},
		[buffer],
	);

	const inputHistory = useInputHistory({
		userMessages,
		onSubmit: handleSubmitAndClear,
		isActive: true,
		currentQuery: buffer.text,
		currentCursorOffset: buffer.getOffset(),
		onChange: customSetText,
	});

	const handleInput = useCallback(
		(key: Key) => {
			if (!focus) {
				return false;
			}

			// History Navigation
			if (
				keyMatchers[Command.HISTORY_UP](key) ||
				keyMatchers[Command.NAVIGATION_UP](key)
			) {
				if (buffer.visualCursor[0] > 0) {
					buffer.move("up");
					return true;
				}
				inputHistory.navigateUp();
				return true;
			}

			if (
				keyMatchers[Command.HISTORY_DOWN](key) ||
				keyMatchers[Command.NAVIGATION_DOWN](key)
			) {
				if (buffer.visualCursor[0] < buffer.allVisualLines.length - 1) {
					buffer.move("down");
					return true;
				}
				inputHistory.navigateDown();
				return true;
			}

			// Submit
			if (keyMatchers[Command.SUBMIT](key)) {
				if (buffer.text.trim()) {
					const [row, col] = buffer.cursor;
					const line = buffer.lines[row] || "";
					const charBefore = col > 0 ? cpSlice(line, col - 1, col) : "";

					if (charBefore === "\\") {
						buffer.backspace();
						buffer.newline();
					} else {
						inputHistory.handleSubmit(buffer.text.trim());
					}
				}
				return true;
			}

			// Cursor Movement
			if (keyMatchers[Command.HOME](key)) {
				buffer.move("home");
				return true;
			}
			if (keyMatchers[Command.END](key)) {
				buffer.move("end");
				return true;
			}
			if (keyMatchers[Command.KILL_LINE_RIGHT](key)) {
				buffer.killLineRight();
				return true;
			}
			if (keyMatchers[Command.KILL_LINE_LEFT](key)) {
				buffer.killLineLeft();
				return true;
			}
			if (keyMatchers[Command.DELETE_WORD_BACKWARD](key)) {
				buffer.deleteWordLeft();
				return true;
			}

			if (keyMatchers[Command.MOVE_LEFT](key)) {
				buffer.move("left");
				return true;
			}

			// Default Buffer Handling
			return buffer.handleInput(key);
		},
		[focus, buffer, keyMatchers, inputHistory],
	);

	useKeypress(handleInput, { isActive: true, priority: true });

	const [cursorVisualRowAbsolute, cursorVisualColAbsolute] =
		buffer.visualCursor;
	const showCursor = focus;

	const renderItem = useCallback(
		(lineText: string, absoluteVisualIdx: number) => {
			const mapEntry = buffer.visualToLogicalMap[absoluteVisualIdx];
			if (!mapEntry) return <Text key={absoluteVisualIdx}> </Text>;

			const isOnCursorLine =
				focus && absoluteVisualIdx === cursorVisualRowAbsolute;
			const renderedLine: React.ReactNode[] = [];

			let display = lineText;

			if (isOnCursorLine) {
				const charToHighlight =
					cpSlice(
						display,
						cursorVisualColAbsolute,
						cursorVisualColAbsolute + 1,
					) || " ";
				const highlighted = showCursor
					? chalk.inverse(charToHighlight)
					: charToHighlight;

				display =
					cpSlice(display, 0, cursorVisualColAbsolute) +
					highlighted +
					cpSlice(display, cursorVisualColAbsolute + 1);
			}

			renderedLine.push(
				<Text key="content" color={theme.text.primary}>
					{display}
				</Text>,
			);

			if (isOnCursorLine && cursorVisualColAbsolute === cpLen(lineText)) {
				renderedLine.push(
					<Text key="cursor-end">{showCursor ? chalk.inverse(" ") : " "}</Text>,
				);
			}

			return (
				<Box height={1} key={`line-${absoluteVisualIdx}`}>
					<Text>{renderedLine}</Text>
				</Box>
			);
		},
		[
			buffer,
			focus,
			cursorVisualRowAbsolute,
			cursorVisualColAbsolute,
			showCursor,
		],
	);

	const scrollableData = buffer.viewportVisualLines;

	return (
		<Box
			flexGrow={1}
			flexDirection="row"
			paddingX={1}
			borderColor={theme.border.default}
			marginTop={1}
			borderTop={true}
			borderBottom={true}
			borderTopColor={theme.text.primary}
			borderBottomColor={theme.text.primary}
		>
			<Text color={theme.text.accent}>{"> "} </Text>
			<Box flexGrow={1} flexDirection="column" ref={innerBoxRef}>
				{buffer.text.length === 0 && placeholder ? (
					showCursor ? (
						<Text>
							{chalk.inverse(placeholder.slice(0, 1))}
							<Text color={theme.text.secondary}>{placeholder.slice(1)}</Text>
						</Text>
					) : (
						<Text color={theme.text.secondary}>{placeholder}</Text>
					)
				) : (
					<Box flexDirection="column" width="100%">
						{scrollableData.map((lineText, index) =>
							renderItem(lineText, index + buffer.visualScrollRow),
						)}
					</Box>
				)}
			</Box>
		</Box>
	);
};
