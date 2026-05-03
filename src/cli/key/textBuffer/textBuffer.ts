import { LRU_BUFFER_PERF_CACHE_LIMIT } from "@cli/constants.js";
import type { Key } from "@cli/context/KeypressContext.js";
import {
	cpLen,
	cpSlice,
	getCachedStringWidth,
	shiftExpandedRegions,
	stripUnsafeCharacters,
	toCodePoints,
} from "@cli/utils/textUtil.js";
import { LRUCache } from "mnemonist";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
	LARGE_PASTE_CHAR_THRESHOLD,
	LARGE_PASTE_LINE_THRESHOLD,
} from "@/cli/ui/InputPrompt.js";
import { PASTED_TEXT_PLACEHOLDER_REGEX } from "./constants.js";
import type {
	Direction,
	ExpandedPasteInfo,
	LineLayoutResult,
	TextBufferAction,
	TextBufferState,
	Transformation,
	UndoHistoryEntry,
	VisualLayout,
} from "./types.js";

const lineLayoutCache = new LRUCache<string, LineLayoutResult>(
	LRU_BUFFER_PERF_CACHE_LIMIT,
);

const historyLimit = 100;

function calculateInitialCursorPosition(
	initialLines: string[],
	offset: number,
): [number, number] {
	let remainingChars = offset;
	let row = 0;
	while (row < initialLines.length) {
		const lineLength = cpLen(initialLines[row]);
		// Add 1 for the newline character (except for the last line)
		const totalCharsInLineAndNewline =
			lineLength + (row < initialLines.length - 1 ? 1 : 0);

		if (remainingChars <= lineLength) {
			// Cursor is on this line
			return [row, remainingChars];
		}
		remainingChars -= totalCharsInLineAndNewline;
		row++;
	}
	// Offset is beyond the text, place cursor at the end of the last line
	if (initialLines.length > 0) {
		const lastRow = initialLines.length - 1;
		return [lastRow, cpLen(initialLines[lastRow])];
	}
	return [0, 0]; // Default for empty text
}

export const replaceRangeInternal = (
	state: TextBufferState,
	startRow: number,
	startCol: number,
	endRow: number,
	endCol: number,
	text: string,
): TextBufferState => {
	const currentLine = (row: number) => state.lines[row] || "";
	const currentLineLen = (row: number) => cpLen(currentLine(row));
	const clamp = (value: number, min: number, max: number) =>
		Math.min(Math.max(value, min), max);

	if (
		startRow > endRow ||
		(startRow === endRow && startCol > endCol) ||
		startRow < 0 ||
		startCol < 0 ||
		endRow >= state.lines.length ||
		(endRow < state.lines.length && endCol > currentLineLen(endRow))
	) {
		return state; // Invalid range
	}

	const newLines = [...state.lines];

	const sCol = clamp(startCol, 0, currentLineLen(startRow));
	const eCol = clamp(endCol, 0, currentLineLen(endRow));

	const prefix = cpSlice(currentLine(startRow), 0, sCol);
	const suffix = cpSlice(currentLine(endRow), eCol);

	const normalisedReplacement = text
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n");
	const replacementParts = normalisedReplacement.split("\n");

	// The combined first line of the new text
	const firstLine = prefix + replacementParts[0];

	if (replacementParts.length === 1) {
		// No newlines in replacement: combine prefix, replacement, and suffix on one line.
		newLines.splice(startRow, endRow - startRow + 1, firstLine + suffix);
	} else {
		// Newlines in replacement: create new lines.
		const lastLine = replacementParts[replacementParts.length - 1] + suffix;
		const middleLines = replacementParts.slice(1, -1);
		newLines.splice(
			startRow,
			endRow - startRow + 1,
			firstLine,
			...middleLines,
			lastLine,
		);
	}

	const finalCursorRow = startRow + replacementParts.length - 1;
	const finalCursorCol =
		(replacementParts.length > 1 ? 0 : sCol) +
		cpLen(replacementParts[replacementParts.length - 1]);

	return {
		...state,
		lines: newLines,
		cursorRow: Math.min(Math.max(finalCursorRow, 0), newLines.length - 1),
		cursorCol: Math.max(
			0,
			Math.min(finalCursorCol, cpLen(newLines[finalCursorRow] || "")),
		),
		preferredCol: null,
	};
};

export function getExpandedPasteAtLine(
	lineIndex: number,
	expandedPaste: ExpandedPasteInfo | null,
): string | null {
	if (
		expandedPaste &&
		lineIndex >= expandedPaste.startLine &&
		lineIndex < expandedPaste.startLine + expandedPaste.lineCount
	) {
		return expandedPaste.id;
	}
	return null;
}

export function detachExpandedPaste(state: TextBufferState): TextBufferState {
	const expandedId = getExpandedPasteAtLine(
		state.cursorRow,
		state.expandedPaste,
	);
	if (!expandedId) return state;

	const { [expandedId]: _, ...newPastedContent } = state.pastedContent;
	return {
		...state,
		expandedPaste: null,
		pastedContent: newPastedContent,
	};
}

export const pushUndo = (currentState: TextBufferState): TextBufferState => {
	const snapshot: UndoHistoryEntry = {
		lines: [...currentState.lines],
		cursorRow: currentState.cursorRow,
		cursorCol: currentState.cursorCol,
		pastedContent: { ...currentState.pastedContent },
		expandedPaste: currentState.expandedPaste
			? { ...currentState.expandedPaste }
			: null,
	};
	const newStack = [...currentState.undoStack, snapshot];
	if (newStack.length > historyLimit) {
		newStack.shift();
	}
	return { ...currentState, undoStack: newStack, redoStack: [] };
};

function generatePastedTextId(
	content: string,
	lineCount: number,
	pastedContent: Record<string, string>,
): string {
	const base =
		lineCount > LARGE_PASTE_LINE_THRESHOLD
			? `[Pasted Text: ${lineCount} lines]`
			: `[Pasted Text: ${content.length} chars]`;

	let id = base;
	let suffix = 2;
	while (pastedContent[id]) {
		id = base.replace("]", ` #${suffix}]`);
		suffix++;
	}
	return id;
}

function normalizePasteContent(content: string): string {
	return stripUnsafeCharacters(
		content.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
	);
}

export function buildExpandedPasteInfo(
	line: string,
	row: number,
	transformation: Transformation,
	pastedContent: Record<string, string>,
): ExpandedPasteInfo | null {
	if (transformation.type !== "paste" || !transformation.id) {
		return null;
	}

	const pastedText = pastedContent[transformation.id];
	if (!pastedText) {
		return null;
	}

	const normalizedContent = normalizePasteContent(pastedText);
	const lineCount = normalizedContent.split("\n").length;

	return {
		id: transformation.id,
		startLine: row,
		lineCount,
		prefix: cpSlice(line, 0, transformation.logStart),
		suffix: cpSlice(line, transformation.logEnd),
	};
}

function getLineLayoutCacheKey(
	line: string,
	viewportWidth: number,
	isCursorOnLine: boolean,
	cursorCol: number,
): string {
	if (!isCursorOnLine) {
		return `${viewportWidth}:N:${line}`;
	}
	return `${viewportWidth}:C:${cursorCol}:${line}`;
}

function calculateVisualCursorFromLayout(
	layout: VisualLayout,
	logicalCursor: [number, number],
): [number, number, number] {
	const { logicalToVisualMap, visualLines, transformedToLogicalMaps } = layout;
	const [logicalRow, logicalCol] = logicalCursor;

	const segmentsForLogicalLine = logicalToVisualMap[logicalRow];

	if (!segmentsForLogicalLine || segmentsForLogicalLine.length === 0) {
		return [0, 0, 0];
	}

	let targetSegmentIndex = segmentsForLogicalLine.findIndex(
		([, startColInLogical], index) => {
			const nextStartColInLogical =
				index + 1 < segmentsForLogicalLine.length
					? segmentsForLogicalLine[index + 1][1]
					: Infinity;
			return (
				logicalCol >= startColInLogical && logicalCol < nextStartColInLogical
			);
		},
	);

	if (targetSegmentIndex === -1) {
		if (logicalCol === 0) {
			targetSegmentIndex = 0;
		} else {
			targetSegmentIndex = segmentsForLogicalLine.length - 1;
		}
	}

	const [visualRow, startColInLogical] =
		segmentsForLogicalLine[targetSegmentIndex];

	// Find the coordinates in transformed space in order to conver to visual
	const transformedToLogicalMap = transformedToLogicalMaps[logicalRow] ?? [];
	let transformedCol = 0;
	for (let i = 0; i < transformedToLogicalMap.length; i++) {
		if (transformedToLogicalMap[i] > logicalCol) {
			transformedCol = Math.max(0, i - 1);
			break;
		}
		if (i === transformedToLogicalMap.length - 1) {
			transformedCol = transformedToLogicalMap.length - 1;
		}
	}
	let startColInTransformed = 0;
	while (
		startColInTransformed < transformedToLogicalMap.length &&
		transformedToLogicalMap[startColInTransformed] < startColInLogical
	) {
		startColInTransformed++;
	}
	const clampedTransformedCol = Math.min(
		transformedCol,
		Math.max(0, transformedToLogicalMap.length - 1),
	);
	const visualColIndex = clampedTransformedCol - startColInTransformed;
	const currentVisualLineText = visualLines[visualRow] ?? "";

	let visualColWidth = 0;
	const codePoints = toCodePoints(currentVisualLineText);

	for (let i = 0; i < Math.min(visualColIndex, codePoints.length); i++) {
		visualColWidth += getCachedStringWidth(codePoints[i]);
	}
	const clampedVisualColIndex = Math.min(
		Math.max(visualColIndex, 0),
		codePoints.length,
	);

	return [visualRow, clampedVisualColIndex, visualColWidth];
}
/**
 * Helper: Converts logical row/col position to absolute text offset
 */
export function logicalPosToOffset(
	lines: string[],
	row: number,
	col: number,
): number {
	let offset = 0;
	const actualRow = Math.min(row, lines.length - 1);
	for (let i = 0; i < actualRow; i++) {
		offset += cpLen(lines[i]) + 1; // +1 for newline
	}
	if (actualRow >= 0 && actualRow < lines.length) {
		offset += Math.min(col, cpLen(lines[actualRow]));
	}
	return offset;
}

/**
 * Helper: Converts absolute text offset to logical row/col position
 */
export function offsetToLogicalPos(
	text: string,
	offset: number,
): [number, number] {
	const lines = text.split("\n");
	let currentOffset = 0;
	for (let i = 0; i < lines.length; i++) {
		const lineLen = cpLen(lines[i]);
		const lineLenWithNewline = lineLen + (i < lines.length - 1 ? 1 : 0);
		if (offset <= currentOffset + lineLen) {
			return [i, offset - currentOffset];
		}
		if (offset < currentOffset + lineLenWithNewline) {
			return [i, lineLen];
		}
		currentOffset += lineLenWithNewline;
	}
	const lastRow = Math.max(0, lines.length - 1);
	return [lastRow, cpLen(lines[lastRow] || "")];
}

function bufferReducerLogic(
	state: TextBufferState,
	action: TextBufferAction,
): TextBufferState {
	const { lines, cursorRow, cursorCol } = state;
	const currentLineText = lines[cursorRow] || "";
	const lineCount = lines.length;
	const pushUndoLocal = pushUndo;

	const currentLine = (r: number): string => state.lines[r] ?? "";

	switch (action.type) {
		case "SET_VIEWPORT":
			return {
				...state,
				viewportWidth: action.payload.width,
				viewportHeight: action.payload.height,
			};

		case "SET_TEXT": {
			let nextState = state;
			if (action.pushToUndo !== false) {
				nextState = pushUndoLocal(state);
			}
			const newContentLines = action.payload
				.replace(/\r\n?/g, "\n")
				.split("\n");
			const lines = newContentLines.length === 0 ? [""] : newContentLines;

			let newCursorRow: number;
			let newCursorCol: number;

			if (typeof action.cursorPosition === "number") {
				[newCursorRow, newCursorCol] = offsetToLogicalPos(
					action.payload,
					action.cursorPosition,
				);
			} else if (action.cursorPosition === "start") {
				newCursorRow = 0;
				newCursorCol = 0;
			} else {
				// Default to 'end'
				newCursorRow = lines.length - 1;
				newCursorCol = cpLen(lines[newCursorRow] ?? "");
			}

			return {
				...nextState,
				lines,
				cursorRow: newCursorRow,
				cursorCol: newCursorCol,
				preferredCol: null,
				pastedContent: action.payload === "" ? {} : nextState.pastedContent,
			};
		}

		case "INSERT": {
			const nextState = detachExpandedPaste(pushUndoLocal(state));
			const newLines = [...nextState.lines];
			let newCursorRow = nextState.cursorRow;
			let newCursorCol = nextState.cursorCol;

			let payload = action.payload;
			let newPastedContent = nextState.pastedContent;

			if (action.isPaste) {
				payload = payload.replace(/\r\n|\r/g, "\n");
				const lineCount = payload.split("\n").length;
				if (
					lineCount > LARGE_PASTE_LINE_THRESHOLD ||
					payload.length > LARGE_PASTE_CHAR_THRESHOLD
				) {
					const id = generatePastedTextId(payload, lineCount, newPastedContent);
					newPastedContent = {
						...newPastedContent,
						[id]: payload,
					};
					payload = id;
				}
			}

			if (payload.length === 0) {
				return state;
			}

			const str = stripUnsafeCharacters(
				payload.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
			);
			const parts = str.split("\n");
			const lineContent = currentLine(newCursorRow);
			const before = cpSlice(lineContent, 0, newCursorCol);
			const after = cpSlice(lineContent, newCursorCol);

			let lineDelta = 0;
			if (parts.length > 1) {
				newLines[newCursorRow] = before + parts[0];
				const remainingParts = parts.slice(1);
				const lastPartOriginal = remainingParts.pop() ?? "";
				newLines.splice(newCursorRow + 1, 0, ...remainingParts);
				newLines.splice(
					newCursorRow + parts.length - 1,
					0,
					lastPartOriginal + after,
				);
				lineDelta = parts.length - 1;
				newCursorRow = newCursorRow + parts.length - 1;
				newCursorCol = cpLen(lastPartOriginal);
			} else {
				newLines[newCursorRow] = before + parts[0] + after;
				newCursorCol = cpLen(before) + cpLen(parts[0]);
			}

			const { newInfo: newExpandedPaste, isDetached } = shiftExpandedRegions(
				nextState.expandedPaste,
				nextState.cursorRow,
				lineDelta,
			);

			if (isDetached && newExpandedPaste === null && nextState.expandedPaste) {
				delete newPastedContent[nextState.expandedPaste.id];
			}

			return {
				...nextState,
				lines: newLines,
				cursorRow: newCursorRow,
				cursorCol: newCursorCol,
				preferredCol: null,
				pastedContent: newPastedContent,
				expandedPaste: newExpandedPaste,
			};
		}

		case "TOGGLE_PASTE_EXPANSION": {
			const { id, row, col } = action.payload;

			if (state.expandedPaste?.id === id) {
				return {
					...state,
					expandedPaste: null,
				};
			}

			const transform = getTransformUnderCursor(
				row,
				col,
				state.transformationsByLine,
				{ includeEdge: true },
			);

			if (!transform || transform.type !== "paste" || transform.id !== id) {
				return state;
			}

			const expandedPaste = buildExpandedPasteInfo(
				state.lines[row] ?? "",
				row,
				transform,
				state.pastedContent,
			);

			if (!expandedPaste) {
				return state;
			}

			return {
				...state,
				expandedPaste,
			};
		}

		case "NEWLINE": {
			const nextState = pushUndoLocal(state);
			const newLines = [...nextState.lines];
			const before = cpSlice(currentLineText, 0, cursorCol);
			const after = cpSlice(currentLineText, cursorCol);
			newLines[cursorRow] = before;
			newLines.splice(cursorRow + 1, 0, after);
			return {
				...state,
				lines: newLines,
				cursorRow: cursorRow + 1,
				cursorCol: 0,
				preferredCol: null,
				redoStack: [],
			};
		}

		case "BACKSPACE": {
			if (cursorCol === 0 && cursorRow === 0) {
				return state;
			}

			const nextState = pushUndoLocal(state);
			const newLines = [...nextState.lines];
			if (cursorCol > 0) {
				newLines[cursorRow] =
					cpSlice(currentLineText, 0, cursorCol - 1) +
					cpSlice(currentLineText, cursorCol);
				return {
					...nextState,
					lines: newLines,
					cursorCol: cursorCol - 1,
					preferredCol: null,
					redoStack: [],
				};
			} else {
				const prevLine = lines[cursorRow - 1];
				const prevLen = cpLen(prevLine);
				newLines[cursorRow - 1] = prevLine + currentLineText;
				newLines.splice(cursorRow, 1);
				return {
					...nextState,
					lines: newLines,
					cursorRow: cursorRow - 1,
					cursorCol: prevLen,
					preferredCol: null,
					redoStack: [],
				};
			}
		}

		case "DELETE": {
			if (cursorCol === cpLen(currentLineText) && cursorRow === lineCount - 1)
				return state;

			const nextState = pushUndoLocal(state);
			const newLines = [...nextState.lines];
			if (cursorCol < cpLen(currentLineText)) {
				newLines[cursorRow] =
					cpSlice(currentLineText, 0, cursorCol) +
					cpSlice(currentLineText, cursorCol + 1);
			} else {
				newLines[cursorRow] = currentLineText + lines[cursorRow + 1];
				newLines.splice(cursorRow + 1, 1);
			}
			return {
				...nextState,
				lines: newLines,
				preferredCol: null,
				redoStack: [],
			};
		}

		case "KILL_LINE_RIGHT": {
			const nextState = pushUndoLocal(state);
			const newLines = [...nextState.lines];
			newLines[cursorRow] = cpSlice(currentLineText, 0, cursorCol);
			return {
				...nextState,
				lines: newLines,
				preferredCol: null,
				redoStack: [],
			};
		}

		case "KILL_LINE_LEFT": {
			const nextState = pushUndoLocal(state);
			const newLines = [...nextState.lines];
			newLines[cursorRow] = cpSlice(currentLineText, cursorCol);
			return {
				...nextState,
				lines: newLines,
				cursorCol: 0,
				preferredCol: null,
				redoStack: [],
			};
		}

		case "DELETE_WORD_LEFT": {
			if (cursorCol === 0) return state;
			const before = cpSlice(currentLineText, 0, cursorCol);
			const after = cpSlice(currentLineText, cursorCol);

			// Simple word boundary: skip whitespace then skip non-whitespace
			let i = before.length - 1;
			while (i >= 0 && before[i] === " ") i--;
			while (i >= 0 && before[i] !== " ") i--;

			const nextState = pushUndoLocal(state);
			const newBefore = before.slice(0, i + 1);
			const newLines = [...nextState.lines];
			newLines[cursorRow] = newBefore + after;

			return {
				...nextState,
				lines: newLines,
				cursorCol: cpLen(newBefore),
				preferredCol: null,
				redoStack: [],
			};
		}

		case "DELETE_WORD_RIGHT": {
			const before = cpSlice(currentLineText, 0, cursorCol);
			const after = cpSlice(currentLineText, cursorCol);
			if (after.length === 0) return state;

			let i = 0;
			while (i < after.length && after[i] === " ") i++;
			while (i < after.length && after[i] !== " ") i++;

			const nextState = pushUndoLocal(state);
			const newAfter = after.slice(i);
			const newLines = [...nextState.lines];
			newLines[cursorRow] = before + newAfter;

			return {
				...nextState,
				lines: newLines,
				preferredCol: null,
				redoStack: [],
			};
		}

		case "MOVE": {
			const { dir } = action;
			const { visualLayout, preferredCol } = state;
			const [vRow, , vWidth] = calculateVisualCursorFromLayout(visualLayout, [
				cursorRow,
				cursorCol,
			]);

			if (
				dir === "left" ||
				dir === "right" ||
				dir === "home" ||
				dir === "end"
			) {
				let r = cursorRow;
				let c = cursorCol;
				if (dir === "left") {
					if (c > 0) c--;
					else if (r > 0) {
						r--;
						c = cpLen(lines[r]);
					}
				} else if (dir === "right") {
					if (c < cpLen(currentLineText)) c++;
					else if (r < lineCount - 1) {
						r++;
						c = 0;
					}
				} else if (dir === "home") c = 0;
				else if (dir === "end") c = cpLen(currentLineText);

				return { ...state, cursorRow: r, cursorCol: c, preferredCol: null };
			}

			let newVisRow = vRow;
			const targetWidth = preferredCol !== null ? preferredCol : vWidth;

			if (dir === "up" && newVisRow > 0) {
				newVisRow--;
			} else if (
				dir === "down" &&
				newVisRow < visualLayout.visualLines.length - 1
			) {
				newVisRow++;
			} else {
				return state;
			}

			const newLineText = visualLayout.visualLines[newVisRow] ?? "";
			const codePoints = toCodePoints(newLineText);
			let currentWidth = 0;
			let newVisColIdx = 0;

			for (let i = 0; i < codePoints.length; i++) {
				const charWidth = getCachedStringWidth(codePoints[i]);
				if (currentWidth + charWidth > targetWidth) {
					break;
				}
				currentWidth += charWidth;
				newVisColIdx = i + 1;
			}

			const mapping = visualLayout.visualToLogicalMap[newVisRow];
			if (mapping) {
				return {
					...state,
					cursorRow: mapping[0],
					cursorCol: mapping[1] + newVisColIdx,
					preferredCol: targetWidth,
				};
			}
			return state;
		}
		case "REPLACE_RANGE": {
			const { startRow, startCol, endRow, endCol, text } = action.payload;
			const nextState = pushUndoLocal(state);
			const newState = replaceRangeInternal(
				nextState,
				startRow,
				startCol,
				endRow,
				endCol,
				text,
			);

			const oldLineCount = endRow - startRow + 1;
			const newLineCount =
				newState.lines.length - (nextState.lines.length - oldLineCount);
			const lineDelta = newLineCount - oldLineCount;

			const { newInfo: newExpandedPaste, isDetached } = shiftExpandedRegions(
				nextState.expandedPaste,
				startRow,
				lineDelta,
				endRow,
			);

			const newPastedContent = { ...newState.pastedContent };
			if (isDetached && nextState.expandedPaste) {
				delete newPastedContent[nextState.expandedPaste.id];
			}

			return {
				...newState,
				pastedContent: newPastedContent,
				expandedPaste: newExpandedPaste,
			};
		}

		case "UNDO": {
			const stateToRestore = state.undoStack[state.undoStack.length - 1];
			if (!stateToRestore) return state;

			const currentSnapshot: UndoHistoryEntry = {
				lines: [...state.lines],
				cursorRow: state.cursorRow,
				cursorCol: state.cursorCol,
				pastedContent: { ...state.pastedContent },
				expandedPaste: state.expandedPaste ? { ...state.expandedPaste } : null,
			};
			return {
				...state,
				...stateToRestore,
				undoStack: state.undoStack.slice(0, -1),
				redoStack: [...state.redoStack, currentSnapshot],
			};
		}

		case "REDO": {
			const stateToRestore = state.redoStack[state.redoStack.length - 1];
			if (!stateToRestore) return state;

			const currentSnapshot: UndoHistoryEntry = {
				lines: [...state.lines],
				cursorRow: state.cursorRow,
				cursorCol: state.cursorCol,
				pastedContent: { ...state.pastedContent },
				expandedPaste: state.expandedPaste ? { ...state.expandedPaste } : null,
			};
			return {
				...state,
				...stateToRestore,
				redoStack: state.redoStack.slice(0, -1),
				undoStack: [...state.undoStack, currentSnapshot],
			};
		}

		default:
			return state;
	}
}

const transformationsCache = new LRUCache<string, Transformation[]>(
	LRU_BUFFER_PERF_CACHE_LIMIT,
);

export function calculateTransformationsForLine(
	line: string,
	pastedContent: Record<string, string> = {},
	expandedPaste: ExpandedPasteInfo | null = null,
	lineIndex?: number,
): Transformation[] {
	const hasPastePlaceholder = line.includes("[Pasted Text:");
	const shouldBypassCache =
		hasPastePlaceholder &&
		expandedPaste !== null &&
		lineIndex === expandedPaste.startLine;
	const cached = !shouldBypassCache
		? transformationsCache.get(line)
		: undefined;
	if (cached !== undefined) {
		return cached;
	}

	const transformations: Transformation[] = [];

	const pasteRegex = new RegExp(PASTED_TEXT_PLACEHOLDER_REGEX.source, "g");
	let match: RegExpExecArray | null;
	match = pasteRegex.exec(line);
	while (match !== null) {
		const logicalText = match[0];
		const logStart = cpLen(line.substring(0, match.index));
		const logEnd = logStart + cpLen(logicalText);
		const isExpanded =
			expandedPaste?.id === logicalText &&
			lineIndex === expandedPaste.startLine;

		transformations.push({
			logStart,
			logEnd,
			logicalText,
			collapsedText: logicalText,
			expandedText: isExpanded
				? normalizePasteContent(pastedContent[logicalText] ?? logicalText)
				: undefined,
			type: "paste",
			id: logicalText,
		});

		match = pasteRegex.exec(line);
	}

	transformations.sort((a, b) => a.logStart - b.logStart);
	if (!shouldBypassCache) {
		transformationsCache.set(line, transformations);
	}

	return transformations;
}

export function calculateTransformedLine(
	logLine: string,
	logIndex: number,
	logicalCursor: [number, number],
	transformations: Transformation[],
	expandedPaste: ExpandedPasteInfo | null = null,
): { transformedLine: string; transformedToLogMap: number[] } {
	let transformedLine = "";
	const transformedToLogMap: number[] = [];
	let lastLogPos = 0;

	const cursorIsOnThisLine = logIndex === logicalCursor[0];
	const cursorCol = logicalCursor[1];

	for (const transform of transformations) {
		const textBeforeTransformation = cpSlice(
			logLine,
			lastLogPos,
			transform.logStart,
		);
		transformedLine += textBeforeTransformation;
		for (let i = 0; i < cpLen(textBeforeTransformation); i++) {
			transformedToLogMap.push(lastLogPos + i);
		}

		const isExpanded =
			(transform.type === "image" &&
				cursorIsOnThisLine &&
				cursorCol >= transform.logStart &&
				cursorCol <= transform.logEnd) ||
			(transform.type === "paste" &&
				transform.id === expandedPaste?.id &&
				logIndex === expandedPaste?.startLine);
		const transformedText = isExpanded
			? (transform.expandedText ?? transform.logicalText)
			: transform.collapsedText;
		transformedLine += transformedText;

		const transformedCodePoints = toCodePoints(transformedText);
		const transformedLen = transformedCodePoints.length;
		if (isExpanded) {
			const logicalLength = Math.max(0, transform.logEnd - transform.logStart);
			const visibleCodePointCount = transformedCodePoints.filter(
				(codePoint) => codePoint !== "\n",
			).length;
			let visibleCodePointIndex = 0;

			for (const codePoint of transformedCodePoints) {
				if (codePoint === "\n") {
					transformedToLogMap.push(transform.logEnd);
					continue;
				}

				const transformationToLogicalOffset =
					visibleCodePointCount === 0 || logicalLength === 0
						? 0
						: Math.floor(
								(visibleCodePointIndex * logicalLength) / visibleCodePointCount,
							);
				transformedToLogMap.push(
					transform.logStart +
						Math.min(
							transformationToLogicalOffset,
							Math.max(logicalLength - 1, 0),
						),
				);
				visibleCodePointIndex++;
			}
		} else {
			const logicalLength = Math.max(0, transform.logEnd - transform.logStart);
			for (let i = 0; i < transformedLen; i++) {
				const transformationToLogicalOffset =
					logicalLength === 0
						? 0
						: Math.floor((i * logicalLength) / transformedLen);
				const transformationToLogicalIndex =
					transform.logStart +
					Math.min(
						transformationToLogicalOffset,
						Math.max(logicalLength - 1, 0),
					);
				transformedToLogMap.push(transformationToLogicalIndex);
			}
		}
		lastLogPos = transform.logEnd;
	}

	// Append text after last transform
	const remainingUntransformedText = cpSlice(logLine, lastLogPos);
	transformedLine += remainingUntransformedText;
	for (let i = 0; i < cpLen(remainingUntransformedText); i++) {
		transformedToLogMap.push(lastLogPos + i);
	}

	// For a cursor at the very end of the transformed line
	transformedToLogMap.push(cpLen(logLine));

	return { transformedLine, transformedToLogMap };
}

function layoutWrappedLine(
	codePointsInLine: string[],
	transformedToLogMap: number[],
	viewportWidth: number,
	logIndex: number,
): {
	visualLines: string[];
	logicalToVisualMap: Array<[number, number]>;
	visualToLogicalMap: Array<[number, number]>;
	visualToTransformedMap: number[];
} {
	const lineVisualLines: string[] = [];
	const lineLogicalToVisualMap: Array<[number, number]> = [];
	const lineVisualToLogicalMap: Array<[number, number]> = [];
	const lineVisualToTransformedMap: number[] = [];

	if (codePointsInLine.length === 0) {
		lineLogicalToVisualMap.push([0, transformedToLogMap[0] ?? 0]);
		lineVisualToLogicalMap.push([logIndex, transformedToLogMap[0] ?? 0]);
		lineVisualToTransformedMap.push(0);
		lineVisualLines.push("");
		return {
			visualLines: lineVisualLines,
			logicalToVisualMap: lineLogicalToVisualMap,
			visualToLogicalMap: lineVisualToLogicalMap,
			visualToTransformedMap: lineVisualToTransformedMap,
		};
	}

	let currentPosInLine = 0;
	while (currentPosInLine < codePointsInLine.length) {
		let currentChunk = "";
		let currentChunkVisualWidth = 0;
		let numCodePointsInChunk = 0;
		let lastWordBreakPoint = -1;
		let numCodePointsAtLastWordBreak = 0;

		for (let i = currentPosInLine; i < codePointsInLine.length; i++) {
			const char = codePointsInLine[i];
			const charVisualWidth = getCachedStringWidth(char);

			if (currentChunkVisualWidth + charVisualWidth > viewportWidth) {
				if (
					lastWordBreakPoint !== -1 &&
					numCodePointsAtLastWordBreak > 0 &&
					currentPosInLine + numCodePointsAtLastWordBreak < i
				) {
					currentChunk = codePointsInLine
						.slice(
							currentPosInLine,
							currentPosInLine + numCodePointsAtLastWordBreak,
						)
						.join("");
					numCodePointsInChunk = numCodePointsAtLastWordBreak;
				} else if (
					numCodePointsInChunk === 0 &&
					charVisualWidth > viewportWidth
				) {
					currentChunk = char;
					numCodePointsInChunk = 1;
				}
				break;
			}

			currentChunk += char;
			currentChunkVisualWidth += charVisualWidth;
			numCodePointsInChunk++;

			if (char === " ") {
				lastWordBreakPoint = i;
				numCodePointsAtLastWordBreak = numCodePointsInChunk - 1;
			}
		}

		if (
			numCodePointsInChunk === 0 &&
			currentPosInLine < codePointsInLine.length
		) {
			currentChunk = codePointsInLine[currentPosInLine] ?? "";
			numCodePointsInChunk = 1;
		}

		const logicalStartCol = transformedToLogMap[currentPosInLine] ?? 0;
		lineLogicalToVisualMap.push([lineVisualLines.length, logicalStartCol]);
		lineVisualToLogicalMap.push([logIndex, logicalStartCol]);
		lineVisualToTransformedMap.push(currentPosInLine);
		lineVisualLines.push(currentChunk);

		const logicalStartOfThisChunk = currentPosInLine;
		currentPosInLine += numCodePointsInChunk;

		if (
			logicalStartOfThisChunk + numCodePointsInChunk <
				codePointsInLine.length &&
			currentPosInLine < codePointsInLine.length &&
			codePointsInLine[currentPosInLine] === " "
		) {
			currentPosInLine++;
		}
	}

	return {
		visualLines: lineVisualLines,
		logicalToVisualMap: lineLogicalToVisualMap,
		visualToLogicalMap: lineVisualToLogicalMap,
		visualToTransformedMap: lineVisualToTransformedMap,
	};
}

function calculateLayout(
	logicalLines: string[],
	viewportWidth: number,
	logicalCursor: [number, number],
	pastedContent: Record<string, string>,
	expandedPaste: ExpandedPasteInfo | null,
): VisualLayout {
	const visualLines: string[] = [];
	const logicalToVisualMap: Array<Array<[number, number]>> = [];
	const visualToLogicalMap: Array<[number, number]> = [];
	const transformedToLogicalMaps: number[][] = [];
	const visualToTransformedMap: number[] = [];

	logicalLines.forEach((logLine, logIndex) => {
		logicalToVisualMap[logIndex] = [];

		const isCursorOnLine = logIndex === logicalCursor[0];
		const isExpandedLine = expandedPaste?.startLine === logIndex;
		const cacheKey = getLineLayoutCacheKey(
			logLine,
			viewportWidth,
			isCursorOnLine,
			logicalCursor[1],
		);
		const cached = isExpandedLine ? undefined : lineLayoutCache.get(cacheKey);

		if (cached) {
			const visualLineOffset = visualLines.length;
			visualLines.push(...cached.visualLines);
			cached.logicalToVisualMap.forEach(([relVisualIdx, logCol]) => {
				logicalToVisualMap[logIndex].push([
					visualLineOffset + relVisualIdx,
					logCol,
				]);
			});
			cached.visualToLogicalMap.forEach(([, logCol]) => {
				visualToLogicalMap.push([logIndex, logCol]);
			});
			transformedToLogicalMaps[logIndex] = cached.transformedToLogMap;
			visualToTransformedMap.push(...cached.visualToTransformedMap);
			return;
		}

		const transformations = calculateTransformationsForLine(
			logLine,
			pastedContent,
			expandedPaste,
			logIndex,
		);
		const { transformedLine, transformedToLogMap } = calculateTransformedLine(
			logLine,
			logIndex,
			logicalCursor,
			transformations,
			expandedPaste,
		);

		const lineVisualLines: string[] = [];
		const lineLogicalToVisualMap: Array<[number, number]> = [];
		const lineVisualToLogicalMap: Array<[number, number]> = [];
		const lineVisualToTransformedMap: number[] = [];

		if (transformedLine.length === 0) {
			lineLogicalToVisualMap.push([0, 0]);
			lineVisualToLogicalMap.push([logIndex, 0]);
			lineVisualToTransformedMap.push(0);
			lineVisualLines.push("");
		} else {
			const transformedCodePoints = toCodePoints(transformedLine);
			let segmentStart = 0;

			for (let i = 0; i <= transformedCodePoints.length; i++) {
				const isLineBreak =
					i === transformedCodePoints.length ||
					transformedCodePoints[i] === "\n";
				if (!isLineBreak) {
					continue;
				}

				const subLineCodePoints = transformedCodePoints.slice(segmentStart, i);
				const subLineMap = transformedToLogMap.slice(segmentStart, i + 1);
				const segmentLayout = layoutWrappedLine(
					subLineCodePoints,
					subLineMap,
					viewportWidth,
					logIndex,
				);

				segmentLayout.logicalToVisualMap.forEach(
					([visualIndex, logicalCol]) => {
						lineLogicalToVisualMap.push([
							lineVisualLines.length + visualIndex,
							logicalCol,
						]);
					},
				);
				lineVisualToLogicalMap.push(...segmentLayout.visualToLogicalMap);
				segmentLayout.visualToTransformedMap.forEach((transformedIndex) => {
					lineVisualToTransformedMap.push(segmentStart + transformedIndex);
				});
				lineVisualLines.push(...segmentLayout.visualLines);

				segmentStart = i + 1;
			}
		}

		if (!isExpandedLine) {
			lineLayoutCache.set(cacheKey, {
				visualLines: lineVisualLines,
				logicalToVisualMap: lineLogicalToVisualMap,
				visualToLogicalMap: lineVisualToLogicalMap,
				transformedToLogMap,
				visualToTransformedMap: lineVisualToTransformedMap,
			});
		}

		const visualLineOffset = visualLines.length;
		visualLines.push(...lineVisualLines);
		lineLogicalToVisualMap.forEach(([relVisualIdx, logCol]) => {
			logicalToVisualMap[logIndex].push([
				visualLineOffset + relVisualIdx,
				logCol,
			]);
		});
		lineVisualToLogicalMap.forEach(([, logCol]) => {
			visualToLogicalMap.push([logIndex, logCol]);
		});
		transformedToLogicalMaps[logIndex] = transformedToLogMap;
		visualToTransformedMap.push(...lineVisualToTransformedMap);
	});

	// If the entire logical text was empty, ensure there's one empty visual line.
	if (
		logicalLines.length === 0 ||
		(logicalLines.length === 1 && logicalLines[0] === "")
	) {
		if (visualLines.length === 0) {
			visualLines.push("");
			if (!logicalToVisualMap[0]) logicalToVisualMap[0] = [];
			logicalToVisualMap[0].push([0, 0]);
			visualToLogicalMap.push([0, 0]);
			visualToTransformedMap.push(0);
		}
	}

	return {
		visualLines,
		logicalToVisualMap,
		visualToLogicalMap,
		transformedToLogicalMaps,
		visualToTransformedMap,
	};
}

export function getTransformUnderCursor(
	row: number,
	col: number,
	spansByLine: Transformation[][],
	options: { includeEdge?: boolean } = {},
): Transformation | null {
	const spans = spansByLine[row];
	if (!spans || spans.length === 0) return null;
	for (const span of spans) {
		if (
			col >= span.logStart &&
			(options.includeEdge ? col <= span.logEnd : col < span.logEnd)
		) {
			return span;
		}
		if (col < span.logStart) break;
	}
	return null;
}

export function calculateTransformations(
	lines: string[],
	pastedContent: Record<string, string> = {},
	expandedPaste: ExpandedPasteInfo | null = null,
): Transformation[][] {
	return lines.map((line, index) =>
		calculateTransformationsForLine(line, pastedContent, expandedPaste, index),
	);
}

function textBufferReducer(
	state: TextBufferState,
	action: TextBufferAction,
): TextBufferState {
	const newState = bufferReducerLogic(state, action);
	const newTransformedLines =
		newState.lines !== state.lines ||
		newState.pastedContent !== state.pastedContent ||
		newState.expandedPaste !== state.expandedPaste
			? calculateTransformations(
					newState.lines,
					newState.pastedContent,
					newState.expandedPaste,
				)
			: state.transformationsByLine;

	const oldTransform = getTransformUnderCursor(
		state.cursorRow,
		state.cursorCol,
		state.transformationsByLine,
	);
	const newTransform = getTransformUnderCursor(
		newState.cursorRow,
		newState.cursorCol,
		newTransformedLines,
	);

	const oldInside = oldTransform !== null;
	const newInside = newTransform !== null;
	const movedBetweenTransforms =
		oldTransform !== newTransform &&
		(oldTransform !== null || newTransform !== null);

	if (
		newState.lines !== state.lines ||
		newState.pastedContent !== state.pastedContent ||
		newState.expandedPaste !== state.expandedPaste ||
		newState.viewportWidth !== state.viewportWidth ||
		oldInside !== newInside ||
		movedBetweenTransforms
	) {
		const shouldResetPreferred =
			oldInside !== newInside || movedBetweenTransforms;

		return {
			...newState,
			preferredCol: shouldResetPreferred ? null : newState.preferredCol,
			visualLayout: calculateLayout(
				newState.lines,
				newState.viewportWidth,
				[newState.cursorRow, newState.cursorCol],
				newState.pastedContent,
				newState.expandedPaste,
			),
			transformationsByLine: newTransformedLines,
		};
	}

	return newState;
}

export function useTextBuffer({
	initialText = "",
	viewportWidth = 80,
	viewportHeight = 10,
	initialCursorOffset = 0,
}: {
	initialText: string;
	viewportWidth: number;
	viewportHeight: number;
	initialCursorOffset?: number;
}) {
	const initialState = useMemo((): TextBufferState => {
		const lines = initialText.split("\n");
		const [initialCursorRow, initialCursorCol] = calculateInitialCursorPosition(
			lines.length === 0 ? [""] : lines,
			initialCursorOffset,
		);
		const transformationsByLine = calculateTransformations(
			lines.length === 0 ? [""] : lines,
			{},
			null,
		);
		const visualLayout = calculateLayout(
			lines.length === 0 ? [""] : lines,
			viewportWidth,
			[initialCursorRow, initialCursorCol],
			{},
			null,
		);
		return {
			lines: lines.length === 0 ? [""] : lines,
			cursorRow: initialCursorRow,
			cursorCol: initialCursorCol,
			transformationsByLine,
			preferredCol: null,
			undoStack: [],
			redoStack: [],
			viewportWidth,
			viewportHeight,
			visualLayout,
			pastedContent: {},
			expandedPaste: null,
			visualScrollRow: 0,
		};
	}, [initialText, initialCursorOffset, viewportWidth, viewportHeight]);

	const [state, dispatch] = useReducer(textBufferReducer, initialState);

	useEffect(() => {
		dispatch({
			type: "SET_VIEWPORT",
			payload: { width: viewportWidth, height: viewportHeight },
		});
	}, [viewportWidth, viewportHeight]);

	const insert = useCallback(
		(ch: string, { paste = false }: { paste?: boolean } = {}): void => {
			if (typeof ch !== "string") {
				return;
			}

			const textToInsert = ch;
			let currentText = "";

			for (const char of toCodePoints(textToInsert)) {
				if (char.codePointAt(0) === 127) {
					if (currentText.length > 0) {
						dispatch({ type: "INSERT", payload: currentText, isPaste: paste });
						currentText = "";
					}
					dispatch({ type: "BACKSPACE" });
				} else {
					currentText += char;
				}
			}
			if (currentText.length > 0) {
				dispatch({ type: "INSERT", payload: currentText, isPaste: paste });
			}
		},
		[],
	);

	const setText = useCallback(
		(text: string, cursorPosition?: "start" | "end" | number) =>
			dispatch({ type: "SET_TEXT", payload: text, cursorPosition }),
		[],
	);
	const backspace = useCallback(() => dispatch({ type: "BACKSPACE" }), []);
	const deleteChar = useCallback(() => dispatch({ type: "DELETE" }), []);
	const newline = useCallback(() => dispatch({ type: "NEWLINE" }), []);
	const killLineRight = useCallback(
		() => dispatch({ type: "KILL_LINE_RIGHT" }),
		[],
	);
	const killLineLeft = useCallback(
		() => dispatch({ type: "KILL_LINE_LEFT" }),
		[],
	);
	const deleteWordLeft = useCallback(
		() => dispatch({ type: "DELETE_WORD_LEFT" }),
		[],
	);
	const deleteWordRight = useCallback(
		() => dispatch({ type: "DELETE_WORD_RIGHT" }),
		[],
	);
	const move = useCallback(
		(dir: Direction) => dispatch({ type: "MOVE", dir }),
		[],
	);
	const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
	const redo = useCallback(() => dispatch({ type: "REDO" }), []);
	const replaceRange = useCallback(
		(
			startRow: number,
			startCol: number,
			endRow: number,
			endCol: number,
			text: string,
		) =>
			dispatch({
				type: "REPLACE_RANGE",
				payload: { startRow, startCol, endRow, endCol, text },
			}),
		[],
	);

	const getOffset = useCallback(
		() => logicalPosToOffset(state.lines, state.cursorRow, state.cursorCol),
		[state.lines, state.cursorRow, state.cursorCol],
	);
	const togglePasteExpansion = useCallback(
		(id: string, row: number, col: number) =>
			dispatch({
				type: "TOGGLE_PASTE_EXPANSION",
				payload: { id, row, col },
			}),
		[],
	);

	const handleInput = useCallback(
		(key: Key): boolean => {
			const { sequence: input } = key;

			if (key.name === "backspace") {
				backspace();
				return true;
			}
			if (key.name === "delete") {
				deleteChar();
				return true;
			}
			if (key.name === "left") {
				move("left");
				return true;
			}
			if (key.name === "right") {
				move("right");
				return true;
			}
			if (key.name === "up") {
				move("up");
				return true;
			}
			if (key.name === "down") {
				move("down");
				return true;
			}
			if (key.name === "home") {
				move("home");
				return true;
			}
			if (key.name === "end") {
				move("end");
				return true;
			}
			if (key.name === "enter" && key.shift) {
				newline();
				return true;
			}
			if (key.name === "paste") {
				insert(input, { paste: true });
				return true;
			}

			if (key.insertable) {
				insert(input, { paste: false });
				return true;
			}

			return false;
		},
		[backspace, deleteChar, move, insert, newline],
	);

	const [vRow, vColIdx, vWidth] = useMemo(
		() =>
			calculateVisualCursorFromLayout(state.visualLayout, [
				state.cursorRow,
				state.cursorCol,
			]),
		[state.visualLayout, state.cursorRow, state.cursorCol],
	);

	const visualCursor = useMemo(
		() => [vRow, vWidth] as [number, number],
		[vRow, vWidth],
	);
	const visualCursorColIndex = vColIdx;

	const viewportVisualLines = useMemo(
		() =>
			state.visualLayout.visualLines.slice(
				state.visualScrollRow,
				state.visualScrollRow + state.viewportHeight,
			),
		[
			state.visualLayout.visualLines,
			state.visualScrollRow,
			state.viewportHeight,
		],
	);

	return useMemo(
		() => ({
			lines: state.lines,
			text: state.lines.join("\n"),
			cursor: [state.cursorRow, state.cursorCol] as [number, number],
			preferredCol: state.preferredCol,
			selectionAnchor: null,
			pastedContent: state.pastedContent,

			// Visual / Viewport properties
			allVisualLines: state.visualLayout.visualLines,
			viewportVisualLines,
			visualCursor,
			visualCursorColIndex,
			visualCursorColWidth: vWidth,
			visualScrollRow: state.visualScrollRow,
			viewportHeight: state.viewportHeight,
			visualToLogicalMap: state.visualLayout.visualToLogicalMap,
			transformedToLogicalMaps: state.visualLayout.transformedToLogicalMaps,
			transformationsByLine: state.transformationsByLine,
			visualToTransformedMap: state.visualLayout.visualToTransformedMap,
			visualLayout: state.visualLayout,

			// Core actions
			insert,
			setText,
			newline,
			backspace,
			del: deleteChar,
			move,
			undo,
			redo,
			replaceRange,
			deleteWordLeft,
			deleteWordRight,
			killLineRight,
			killLineLeft,
			handleInput,
			getOffset,

			replaceRangeByOffset: (_s: number, _e: number, _t: string) => {},
			moveToOffset: (_offset: number) => {},
			moveToVisualPosition: (_vr: number, _vc: number) => {},
			getLogicalPositionFromVisual: (_vr: number, _vc: number) => null,
			getExpandedPasteAtLine: (lineIndex: number) =>
				getExpandedPasteAtLine(lineIndex, state.expandedPaste),
			togglePasteExpansion,
		}),
		[
			state,
			viewportVisualLines,
			visualCursor,
			visualCursorColIndex,
			vWidth,
			insert,
			setText,
			newline,
			backspace,
			deleteChar,
			move,
			undo,
			redo,
			replaceRange,
			deleteWordLeft,
			deleteWordRight,
			killLineRight,
			killLineLeft,
			handleInput,
			getOffset,
			togglePasteExpansion,
		],
	);
}
export type TextBuffer = ReturnType<typeof useTextBuffer>;
