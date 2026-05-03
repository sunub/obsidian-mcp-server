import { useInputState } from "@cli/context/InputContext.js";
import { useInputHistory } from "@cli/hooks/useInputHistory.js";
import { useKeyMatchers } from "@cli/hooks/useKeyMatchers.js";
import { type Key, useKeypress } from "@cli/hooks/useKeypress.js";
import { Command } from "@cli/key/keyMatchers.js";
import { getTransformUnderCursor } from "@cli/key/textBuffer/index.js";
import { theme } from "@cli/theme/semantic-colors.js";
import { cpIndexToOffset, cpLen, cpSlice } from "@cli/utils/textUtil.js";
import chalk from "chalk";
import clipboardy from "clipboardy";
import { Box, Text } from "ink";
import type React from "react";
import { useCallback, useRef } from "react";
import { debugLogger } from "@/shared/index.js";
import {
	parseInputForHighlighting,
	parseSegmentsFromTokens,
} from "../utils/highlights.js";

export interface InputPromptProps {
	onSubmit: (
		value: string,
		submissionContext?: InputSubmissionContext,
	) => void | Promise<void>;
	placeholder?: string;
	focus?: boolean;
}

export interface InputSubmissionContext {
	pastedContent: Record<string, string>;
}

export function createInputSubmissionContext(
	pastedContent: Record<string, string>,
): InputSubmissionContext {
	return {
		pastedContent: { ...pastedContent },
	};
}

export const LARGE_PASTE_LINE_THRESHOLD = 3;
export const LARGE_PASTE_CHAR_THRESHOLD = 200;

export function isLargePaste(text: string): boolean {
	const pasteLineCount = text.split("\n").length;
	return (
		pasteLineCount > LARGE_PASTE_LINE_THRESHOLD ||
		text.length > LARGE_PASTE_CHAR_THRESHOLD
	);
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
	const submissionInFlightRef = useRef(false);
	const lastKeystrokeTimeRef = useRef<number>(0);
	const pasteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	const handleClipboardPaste = useCallback(async () => {
		try {
			const textToInsert = await clipboardy.read();
			debugLogger.info("Pasting from clipboard:", {
				length: textToInsert.length,
				lineCount: textToInsert.split("\n").length,
				largePaste: isLargePaste(textToInsert),
			});
			buffer.insert(textToInsert, { paste: true });
		} catch (error) {
			debugLogger.error("Error handling paste:", error);
		}
	}, [buffer]);

	const handleSubmitAndClear = useCallback(
		async (submittedValue: string) => {
			if (submissionInFlightRef.current) return;
			submissionInFlightRef.current = true;

			try {
				const submissionContext = createInputSubmissionContext(
					buffer.pastedContent,
				);
				buffer.setText("");
				await onSubmit(submittedValue, submissionContext);
			} finally {
				submissionInFlightRef.current = false;
			}
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
	const handleSubmit = useCallback(
		(submittedValue: string) => {
			const trimmedMessage = submittedValue.trim();
			inputHistory.handleSubmit(trimmedMessage);
		},
		[inputHistory],
	);

	const handleInput = useCallback(
		(key: Key) => {
			if (!focus) {
				return false;
			}

			const now = Date.now();
			const interval = now - lastKeystrokeTimeRef.current;
			lastKeystrokeTimeRef.current = now;

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

			if (!focus && key.name !== "paste") {
				return false;
			}

			if (key.name === "paste") {
				if (pasteTimeoutRef.current) {
					clearTimeout(pasteTimeoutRef.current);
				}

				pasteTimeoutRef.current = setTimeout(() => {
					pasteTimeoutRef.current = null;
				}, 40);

				buffer.handleInput(key);
				return true;
			}

			if (keyMatchers[Command.PASTE_CLIPBOARD](key)) {
				void handleClipboardPaste();
				return true;
			}

			if (keyMatchers[Command.EXPAND_PASTE](key)) {
				const transform = getTransformUnderCursor(
					buffer.cursor[0],
					buffer.cursor[1],
					buffer.transformationsByLine,
					{ includeEdge: true },
				);
				if (transform?.type === "paste" && transform.id) {
					buffer.togglePasteExpansion(
						transform.id,
						buffer.cursor[0],
						buffer.cursor[1],
					);
				}
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

			if (keyMatchers[Command.SUBMIT](key)) {
				if (buffer.text.trim()) {
					const [row, col] = buffer.cursor;
					const line = buffer.lines[row];
					const charBefore = col > 0 ? cpSlice(line, col - 1, col) : "";
					if (charBefore === "\\") {
						buffer.backspace();
						buffer.newline();
					} else {
						handleSubmit(buffer.text);
					}
				}
				return true;
			}

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

			// Fast Paste Detection Heuristic:
			// If characters arrive with < 5ms interval, treat as paste.
			const isInputStorm = interval < 5;

			if (key.insertable && key.sequence) {
				buffer.insert(key.sequence, { paste: isInputStorm });
				return true;
			}

			return buffer.handleInput(key);
		},
		[
			focus,
			buffer,
			keyMatchers,
			inputHistory,
			handleClipboardPaste,
			handleSubmit,
		],
	);

	useKeypress(handleInput, { isActive: true, priority: true });
	const [cursorVisualRowAbsolute, cursorVisualColAbsolute] =
		buffer.visualCursor;

	const showCursor = focus;

	const renderItem = useCallback(
		(lineText: string, absoluteVisualIdx: number) => {
			const mapEntry = buffer.visualToLogicalMap[absoluteVisualIdx];
			if (!mapEntry) return <Text> </Text>;

			const isOnCursorLine =
				focus && absoluteVisualIdx === cursorVisualRowAbsolute;
			const renderedLine: React.ReactNode[] = [];
			const [logicalLineIdx] = mapEntry;
			const logicalLine = buffer.lines[logicalLineIdx] || "";
			const transformations =
				buffer.transformationsByLine[logicalLineIdx] ?? [];
			const tokens = parseInputForHighlighting(
				logicalLine,
				logicalLineIdx,
				transformations,
				...(focus && buffer.cursor[0] === logicalLineIdx
					? [buffer.cursor[1]]
					: []),
			);
			const visualStartCol =
				buffer.visualToTransformedMap[absoluteVisualIdx] ?? 0;
			const visualEndCol = visualStartCol + cpLen(lineText);
			const segments = parseSegmentsFromTokens(
				tokens,
				visualStartCol,
				visualEndCol,
			);
			let charCount = 0;
			segments.forEach((seg, segIdx) => {
				const segLen = cpLen(seg.text);
				let display = seg.text;
				if (isOnCursorLine) {
					const relCol = cursorVisualColAbsolute;
					const segStart = charCount;
					const segEnd = segStart + segLen;
					if (relCol >= segStart && relCol < segEnd) {
						const charToHighlight = cpSlice(
							display,
							relCol - segStart,
							relCol - segStart + 1,
						);
						const highlighted = showCursor
							? chalk.inverse(charToHighlight)
							: charToHighlight;
						display =
							cpSlice(display, 0, relCol - segStart) +
							highlighted +
							cpSlice(display, relCol - segStart + 1);
					}
					charCount = segEnd;
				} else {
					charCount += segLen;
				}
				const color =
					seg.type === "command" || seg.type === "file" || seg.type === "paste"
						? theme.text.accent
						: theme.text.primary;

				const key = `seg${absoluteVisualIdx}-${segIdx}`;
				renderedLine.push(
					<Text key={key} color={color}>
						{display}
					</Text>,
				);
			});

			if (isOnCursorLine && cursorVisualColAbsolute === cpLen(lineText)) {
				renderedLine.push(
					<Text key={`cursor-end-${cursorVisualColAbsolute}`}>
						{showCursor ? chalk.inverse(" ") : " "}
					</Text>,
				);
			}
			const showCursorBeforeGhost =
				focus && isOnCursorLine && cursorVisualColAbsolute === cpLen(lineText);

			return (
				<Box height={1} key={absoluteVisualIdx}>
					<Text
						terminalCursorFocus={showCursor && isOnCursorLine}
						terminalCursorPosition={cpIndexToOffset(
							lineText,
							cursorVisualColAbsolute,
						)}
					>
						{renderedLine}
						{showCursorBeforeGhost && (showCursor ? chalk.inverse(" ") : " ")}
					</Text>
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
						<Text terminalCursorFocus={showCursor} terminalCursorPosition={0}>
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
