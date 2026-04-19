// @ts-nocheck
import React from "react";
import { useCallback, useRef, useState } from "react";
import chalk from "chalk";
import { Box, Text, useInput, type Key as InkKey } from "ink";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InputPromptProps {
	onSubmit: (value: string) => void;
	placeholder?: string;
	focus?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function linesToText(lines: string[]): string {
	return lines.join("\n");
}

// ─── Component ────────────────────────────────────────────────────────────────

export const InputPrompt: React.FC<InputPromptProps> = ({
	onSubmit,
	placeholder = "Type your message",
	focus = true,
}) => {
	// Multi-line text stored as an array of lines; cursor is [row, col].
	const [lines, setLines] = useState<string[]>([""]);
	const [cursor, setCursor] = useState<[number, number]>([0, 0]);

	// Simple input history (newest first).
	const [history, setHistory] = useState<string[]>([]);
	const historyIdxRef = useRef<number>(-1);
	const savedDraftRef = useRef<string>("");

	// Restore a string into the editor, placing the cursor at the end.
	const setText = useCallback((text: string) => {
		const newLines = text.split("\n");
		const lastRow = newLines.length - 1;
		setLines(newLines);
		setCursor([lastRow, newLines[lastRow].length]);
	}, []);

	// Submit the current text, push it to history, and reset the buffer.
	const handleSubmitAndClear = useCallback(
		(text: string) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			setHistory((prev) => [trimmed, ...prev]);
			historyIdxRef.current = -1;
			savedDraftRef.current = "";
			setLines([""]);
			setCursor([0, 0]);
			onSubmit(trimmed);
		},
		[onSubmit],
	);

	// ─── Key handler ──────────────────────────────────────────────────────────

	const handleInput = useCallback(
		(input: string, key: InkKey): void => {
			// Enter → submit (plain Enter only)
			if (key.return && !key.shift) {
				const text = linesToText(lines);
				if (text.trim()) handleSubmitAndClear(text);
				return;
			}

			// Shift+Enter → newline
			if (key.return && key.shift) {
				const [row, col] = cursor;
				const newLines = [...lines];
				const cur = newLines[row];
				newLines[row] = cur.slice(0, col);
				newLines.splice(row + 1, 0, cur.slice(col));
				setLines(newLines);
				setCursor([row + 1, 0]);
				return;
			}

			// Escape → clear buffer
			if (key.escape) {
				if (linesToText(lines).length > 0) {
					setLines([""]);
					setCursor([0, 0]);
				}
				return;
			}

			// Up arrow: move cursor up within multi-line buffer, or navigate history
			if (key.upArrow) {
				const [row] = cursor;
				if (row > 0) {
					setCursor(([r, c]) => [r - 1, Math.min(c, lines[r - 1].length)]);
					return;
				}
				const newIdx = historyIdxRef.current + 1;
				if (newIdx < history.length) {
					if (historyIdxRef.current === -1) {
						savedDraftRef.current = linesToText(lines);
					}
					historyIdxRef.current = newIdx;
					setText(history[newIdx]);
				}
				return;
			}

			// Down arrow: move cursor down within multi-line buffer, or navigate history
			if (key.downArrow) {
				const [row] = cursor;
				if (row < lines.length - 1) {
					setCursor(([r, c]) => [r + 1, Math.min(c, lines[r + 1].length)]);
					return;
				}
				if (historyIdxRef.current > -1) {
					const newIdx = historyIdxRef.current - 1;
					historyIdxRef.current = newIdx;
					setText(newIdx === -1 ? savedDraftRef.current : history[newIdx]);
				}
				return;
			}

			// Left arrow
			if (key.leftArrow) {
				const [row, col] = cursor;
				if (col > 0) {
					setCursor([row, col - 1]);
				} else if (row > 0) {
					setCursor([row - 1, lines[row - 1].length]);
				}
				return;
			}

			// Right arrow
			if (key.rightArrow) {
				const [row, col] = cursor;
				if (col < lines[row].length) {
					setCursor([row, col + 1]);
				} else if (row < lines.length - 1) {
					setCursor([row + 1, 0]);
				}
				return;
			}

			// Ctrl+A → beginning of line
			if (key.ctrl && input === "a") {
				setCursor(([r]) => [r, 0]);
				return;
			}

			// Ctrl+E → end of line
			if (key.ctrl && input === "e") {
				setCursor(([r]) => [r, lines[r].length]);
				return;
			}

			// Ctrl+K → kill from cursor to end of line (or join next line)
			if (key.ctrl && input === "k") {
				const [row, col] = cursor;
				const newLines = [...lines];
				if (col < newLines[row].length) {
					newLines[row] = newLines[row].slice(0, col);
				} else if (row < newLines.length - 1) {
					newLines[row] = newLines[row] + newLines[row + 1];
					newLines.splice(row + 1, 1);
				}
				setLines(newLines);
				return;
			}

			// Ctrl+W → delete word backward
			if (key.ctrl && input === "w") {
				const [row, col] = cursor;
				const newLines = [...lines];
				const line = newLines[row];
				let i = col;
				while (i > 0 && line[i - 1] === " ") i--;
				while (i > 0 && line[i - 1] !== " ") i--;
				newLines[row] = line.slice(0, i) + line.slice(col);
				setLines(newLines);
				setCursor([row, i]);
				return;
			}

			// Backspace → delete character before cursor
			if (key.backspace || key.delete) {
				const [row, col] = cursor;
				const newLines = [...lines];
				if (col > 0) {
					newLines[row] =
						newLines[row].slice(0, col - 1) + newLines[row].slice(col);
					setLines(newLines);
					setCursor([row, col - 1]);
				} else if (row > 0) {
					const prevLen = newLines[row - 1].length;
					newLines[row - 1] = newLines[row - 1] + newLines[row];
					newLines.splice(row, 1);
					setLines(newLines);
					setCursor([row - 1, prevLen]);
				}
				return;
			}

			// Printable character / multi-line paste insertion
			if (input && !key.ctrl && !key.meta) {
				const [row, col] = cursor;
				const newLines = [...lines];
				const pasteLines = input.split("\n");
				if (pasteLines.length === 1) {
					newLines[row] =
						newLines[row].slice(0, col) + input + newLines[row].slice(col);
					setLines(newLines);
					setCursor([row, col + input.length]);
				} else {
					const before = newLines[row].slice(0, col);
					const after = newLines[row].slice(col);
					const last = pasteLines[pasteLines.length - 1];
					newLines[row] = before + pasteLines[0];
					newLines.splice(row + 1, 0, ...pasteLines.slice(1, -1), last + after);
					setLines(newLines);
					setCursor([row + pasteLines.length - 1, last.length]);
				}
			}
		},
		[lines, cursor, history, setText, handleSubmitAndClear],
	);

	useInput(handleInput, { isActive: focus });

	// ─── Render ───────────────────────────────────────────────────────────────

	const isEmpty = lines.length === 1 && lines[0] === "";
	const [cursorRow, cursorCol] = cursor;

	const renderLine = (line: string, rowIdx: number): React.ReactNode => {
		const isOnCursorLine = focus && rowIdx === cursorRow;
		if (!isOnCursorLine) {
			return (
				<Box key={rowIdx} height={1}>
					<Text>{line || " "}</Text>
				</Box>
			);
		}
		const before = line.slice(0, cursorCol);
		const atCursor = line[cursorCol] ?? " ";
		const after = line.slice(cursorCol + 1);
		return (
			<Box key={rowIdx} height={1}>
				<Text>
					{before}
					{chalk.inverse(atCursor)}
					{after}
				</Text>
			</Box>
		);
	};

	return (
		<Box
			flexGrow={1}
			flexDirection="row"
			paddingX={1}
			borderStyle="round"
			borderColor="cyan"
		>
			<Text color="cyan">{"> "}</Text>
			<Box flexGrow={1} flexDirection="column">
				{isEmpty ? (
					<Text color="gray">{placeholder}</Text>
				) : (
					lines.map((line, rowIdx) => renderLine(line, rowIdx))
				)}
			</Box>
		</Box>
	);
};
