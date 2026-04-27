import { useInputState } from "@cli/context/InputContext.js";
import { useInputHistory } from "@cli/hooks/useInputHistory.js";
import { useKeyMatchers } from "@cli/hooks/useKeyMatchers.js";
import { type Key, useKeypress } from "@cli/hooks/useKeypress.js";
import { Command } from "@cli/key/keyMatchers.js";
import { theme } from "@cli/theme/semantic-colors.js";
import { cpIndexToOffset, cpSlice } from "@cli/utils/textUtil.js";
import chalk from "chalk";
import { Box, Text } from "ink";
import type React from "react";
import { useCallback, useRef } from "react";

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

	const [cursorVisualRowAbsolute] = buffer.visualCursor;
	const cursorVisualColIndex = buffer.visualCursorColIndex;
	const showCursor = focus;

	const renderItem = useCallback(
		(lineText: string, absoluteVisualIdx: number) => {
			const mapEntry = buffer.visualToLogicalMap[absoluteVisualIdx];
			if (!mapEntry) return <Text key={absoluteVisualIdx}> </Text>;

			const isOnCursorLine =
				focus && absoluteVisualIdx === cursorVisualRowAbsolute;

			if (!isOnCursorLine) {
				return (
					<Box height={1} key={`line-${absoluteVisualIdx}`}>
						<Text color={theme.text.primary}>{lineText}</Text>
					</Box>
				);
			}

			// Cursor Line: Declarative split for hardware cursor alignment
			const before = cpSlice(lineText, 0, cursorVisualColIndex);
			const at =
				cpSlice(lineText, cursorVisualColIndex, cursorVisualColIndex + 1) ||
				" ";
			const after = cpSlice(lineText, cursorVisualColIndex + 1);

			return (
				<Box height={1} key={`line-${absoluteVisualIdx}`}>
					<Text
						// @ts-expect-error - 커스텀 Ink 속성
						terminalCursorFocus={showCursor && isOnCursorLine}
						terminalCursorPosition={cpIndexToOffset(
							lineText,
							cursorVisualColIndex,
						)}
					>
						<Text color={theme.text.primary}>{before}</Text>
						<Text inverse={showCursor}>{at}</Text>
						<Text color={theme.text.primary}>{after}</Text>
					</Text>
				</Box>
			);
		},
		[
			buffer.visualToLogicalMap,
			focus,
			cursorVisualRowAbsolute,
			cursorVisualColIndex,
			showCursor,
		],
	);

	const scrollableData = buffer.viewportVisualLines;

	return (
		<Box
			flexGrow={1}
			flexDirection="row"
			paddingX={1}
			borderStyle={"bold"}
			borderTop={true}
			borderBottom={true}
			borderLeft={false}
			borderRight={false}
			borderTopColor={theme.text.accent}
			borderBottomColor={theme.text.accent}
		>
			<Text color={theme.text.accent}>{"> "} </Text>
			<Box flexGrow={1} flexDirection="column" ref={innerBoxRef}>
				{buffer.text.length === 0 && placeholder ? (
					showCursor ? (
						<Text
							// @ts-expect-error - 커스텀 Ink 속성
							terminalCursorFocus={showCursor}
							terminalCursorPosition={0}
						>
							{chalk.inverse(placeholder.slice(0, 1))}
							<Text color={theme.text.secondary}>{placeholder.slice(1)}</Text>
						</Text>
					) : (
						<Text color={theme.text.secondary}>{placeholder}</Text>
					)
				) : (
					<Box flexDirection="column" width="100%">
						{scrollableData.map((lineText: string, index: number) =>
							renderItem(lineText, index + buffer.visualScrollRow),
						)}
					</Box>
				)}
			</Box>
		</Box>
	);
};
