import { useReducer, useCallback, useMemo, useEffect } from "react";
import {
  cpLen,
  cpSlice,
  getCachedStringWidth,
  toCodePoints,
} from "../utils/textUtil.js";

import type { Key } from "../context/KeypressContext.js";
import { LRUCache } from "mnemonist";
import { LRU_BUFFER_PERF_CACHE_LIMIT } from "../constants.js";

export const PASTED_TEXT_PLACEHOLDER_REGEX =
  /\[Pasted Text: \d+ (?:lines|chars)(?: #\d+)?\]/g;

export interface TextBuffer {
  // State
  lines: string[]; // Logical lines
  text: string;
  cursor: [number, number]; // Logical cursor [row, col]
  /**
   * When the user moves the caret vertically we try to keep their original
   * horizontal column even when passing through shorter lines.  We remember
   * that *preferred* column in this field while the user is still travelling
   * vertically.  Any explicit horizontal movement resets the preference.
   */
  preferredCol: number | null; // Preferred visual column
  selectionAnchor: [number, number] | null; // Logical selection anchor
  pastedContent: Record<string, string>;

  // Visual state (handles wrapping)
  allVisualLines: string[]; // All visual lines for the current text and viewport width.
  viewportVisualLines: string[]; // The subset of visual lines to be rendered based on visualScrollRow and viewport.height
  visualCursor: [number, number]; // Visual cursor [row, col] relative to the start of all visualLines
  visualScrollRow: number; // Scroll position for visual lines (index of the first visible visual line)
  viewportHeight: number; // The maximum height of the viewport
  /**
   * For each visual line (by absolute index in allVisualLines) provides a tuple
   * [logicalLineIndex, startColInLogical] that maps where that visual line
   * begins within the logical buffer. Indices are code-point based.
   */
  visualToLogicalMap: Array<[number, number]>;
  /**
   * For each logical line, an array mapping transformed positions (in the transformed
   * line) back to logical column indices.
   */
  transformedToLogicalMaps: number[][];
  /**
   * For each visual line (absolute index across all visual lines), the start index
   * within that logical line's transformed content.
   */
  visualToTransformedMap: number[];
  /** Cached transformations per logical line */
  visualLayout: VisualLayout;

  // Actions

  /**
   * Replaces the entire buffer content with the provided text.
   * The operation is undoable.
   */
  setText: (text: string, cursorPosition?: "start" | "end" | number) => void;
  /**
   * Insert a single character or string without newlines.
   */
  insert: (ch: string, opts?: { paste?: boolean }) => void;
  newline: () => void;
  backspace: () => void;
  del: () => void;
  move: (dir: Direction) => void;
  undo: () => void;
  redo: () => void;
  /**
   * Replaces the text within the specified range with new text.
   * Handles both single-line and multi-line ranges.
   *
   * @param startRow The starting row index (inclusive).
   * @param startCol The starting column index (inclusive, code-point based).
   * @param endRow The ending row index (inclusive).
   * @param endCol The ending column index (exclusive, code-point based).
   * @param text The new text to insert.
   * @returns True if the buffer was modified, false otherwise.
   */
  replaceRange: (
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    text: string,
  ) => void;
  /**
   * Delete the word to the *left* of the caret, mirroring common
   * Ctrl/Alt+Backspace behaviour in editors & terminals. Both the adjacent
   * whitespace *and* the word characters immediately preceding the caret are
   * removed.  If the caret is already at column‑0 this becomes a no-op.
   */
  deleteWordLeft: () => void;
  /**
   * Delete the word to the *right* of the caret, akin to many editors'
   * Ctrl/Alt+Delete shortcut.  Removes any whitespace/punctuation that
   * follows the caret and the next contiguous run of word characters.
   */
  deleteWordRight: () => void;

  /**
   * Deletes text from the cursor to the end of the current line.
   */
  killLineRight: () => void;
  /**
   * Deletes text from the start of the current line to the cursor.
   */
  killLineLeft: () => void;
  /**
   * High level "handleInput" – receives what Ink gives us.
   */
  handleInput: (key: Key) => boolean;
  /**
   * Opens the current buffer contents in the user's preferred terminal text
   * editor ($VISUAL or $EDITOR, falling back to "vi").  The method blocks
   * until the editor exits, then reloads the file and replaces the in‑memory
   * buffer with whatever the user saved.
   *
   * The operation is treated as a single undoable edit – we snapshot the
   * previous state *once* before launching the editor so one `undo()` will
   * revert the entire change set.
   *
   * Note: We purposefully rely on the *synchronous* spawn API so that the
   * calling process genuinely waits for the editor to close before
   * continuing.  This mirrors Git's behaviour and simplifies downstream
   * control‑flow (callers can simply `await` the Promise).
   */
  openInExternalEditor: () => Promise<void>;

  replaceRangeByOffset: (
    startOffset: number,
    endOffset: number,
    replacementText: string,
  ) => void;
  getOffset: () => number;
  moveToOffset(offset: number): void;
  moveToVisualPosition(visualRow: number, visualCol: number): void;
  /**
   * Convert visual coordinates to logical position without moving cursor.
   * Returns null if the position is out of bounds.
   */
  getLogicalPositionFromVisual(
    visualRow: number,
    visualCol: number,
  ): { row: number; col: number } | null;
  /**
   * Check if a line index falls within an expanded paste region.
   * Returns the paste placeholder ID if found, null otherwise.
   */
  getExpandedPasteAtLine(lineIndex: number): string | null;
  /**
   * Toggle expansion state for a paste placeholder.
   * If collapsed, expands to show full content inline.
   * If expanded, collapses back to placeholder.
   */
  togglePasteExpansion(id: string, row: number, col: number): void;
  /**
   * The current expanded paste info (read-only).
   */
  /**
   * Delete N words forward from cursor position (vim 'dw' command)
   */
  vimDeleteWordForward: (count: number) => void;
  /**
   * Delete N words backward from cursor position (vim 'db' command)
   */
  vimDeleteWordBackward: (count: number) => void;
  /**
   * Delete to end of N words from cursor position (vim 'de' command)
   */
  vimDeleteWordEnd: (count: number) => void;
  /**
   * Delete N big words forward from cursor position (vim 'dW' command)
   */
  vimDeleteBigWordForward: (count: number) => void;
  /**
   * Delete N big words backward from cursor position (vim 'dB' command)
   */
  vimDeleteBigWordBackward: (count: number) => void;
  /**
   * Delete to end of N big words from cursor position (vim 'dE' command)
   */
  vimDeleteBigWordEnd: (count: number) => void;
  /**
   * Change N words forward from cursor position (vim 'cw' command)
   */
  vimChangeWordForward: (count: number) => void;
  /**
   * Change N words backward from cursor position (vim 'cb' command)
   */
  vimChangeWordBackward: (count: number) => void;
  /**
   * Change to end of N words from cursor position (vim 'ce' command)
   */
  vimChangeWordEnd: (count: number) => void;
  /**
   * Change N big words forward from cursor position (vim 'cW' command)
   */
  vimChangeBigWordForward: (count: number) => void;
  /**
   * Change N big words backward from cursor position (vim 'cB' command)
   */
  vimChangeBigWordBackward: (count: number) => void;
  /**
   * Change to end of N big words from cursor position (vim 'cE' command)
   */
  vimChangeBigWordEnd: (count: number) => void;
  /**
   * Delete N lines from cursor position (vim 'dd' command)
   */
  vimDeleteLine: (count: number) => void;
  /**
   * Change N lines from cursor position (vim 'cc' command)
   */
  vimChangeLine: (count: number) => void;
  /**
   * Delete from cursor to end of line (vim 'D' command)
   * With count > 1, deletes to end of current line plus (count-1) additional lines
   */
  vimDeleteToEndOfLine: (count?: number) => void;
  /**
   * Delete from start of line to cursor (vim 'd0' command)
   */
  vimDeleteToStartOfLine: () => void;
  /**
   * Change from cursor to end of line (vim 'C' command)
   * With count > 1, changes to end of current line plus (count-1) additional lines
   */
  vimChangeToEndOfLine: (count?: number) => void;
  /**
   * Delete from cursor to first non-whitespace character (vim 'd^' command)
   */
  vimDeleteToFirstNonWhitespace: () => void;
  /**
   * Change from cursor to start of line (vim 'c0' command)
   */
  vimChangeToStartOfLine: () => void;
  /**
   * Change from cursor to first non-whitespace character (vim 'c^' command)
   */
  vimChangeToFirstNonWhitespace: () => void;
  /**
   * Delete from current line to first line (vim 'dgg' command)
   */
  vimDeleteToFirstLine: (count: number) => void;
  /**
   * Delete from current line to last line (vim 'dG' command)
   */
  vimDeleteToLastLine: (count: number) => void;
  /**
   * Change movement operations (vim 'ch', 'cj', 'ck', 'cl' commands)
   */
  vimChangeMovement: (movement: "h" | "j" | "k" | "l", count: number) => void;
  /**
   * Move cursor left N times (vim 'h' command)
   */
  vimMoveLeft: (count: number) => void;
  /**
   * Move cursor right N times (vim 'l' command)
   */
  vimMoveRight: (count: number) => void;
  /**
   * Move cursor up N times (vim 'k' command)
   */
  vimMoveUp: (count: number) => void;
  /**
   * Move cursor down N times (vim 'j' command)
   */
  vimMoveDown: (count: number) => void;
  /**
   * Move cursor forward N words (vim 'w' command)
   */
  vimMoveWordForward: (count: number) => void;
  /**
   * Move cursor backward N words (vim 'b' command)
   */
  vimMoveWordBackward: (count: number) => void;
  /**
   * Move cursor to end of Nth word (vim 'e' command)
   */
  vimMoveWordEnd: (count: number) => void;
  /**
   * Move cursor forward N big words (vim 'W' command)
   */
  vimMoveBigWordForward: (count: number) => void;
  /**
   * Move cursor backward N big words (vim 'B' command)
   */
  vimMoveBigWordBackward: (count: number) => void;
  /**
   * Move cursor to end of Nth big word (vim 'E' command)
   */
  vimMoveBigWordEnd: (count: number) => void;
  /**
   * Delete N characters at cursor (vim 'x' command)
   */
  vimDeleteChar: (count: number) => void;
  /** Delete N characters before cursor (vim 'X') */
  vimDeleteCharBefore: (count: number) => void;
  /** Toggle case of N characters at cursor (vim '~') */
  vimToggleCase: (count: number) => void;
  /** Replace N characters at cursor with char, stay in NORMAL mode (vim 'r') */
  vimReplaceChar: (char: string, count: number) => void;
  /** Move to Nth occurrence of char forward on line; till=true stops before it (vim 'f'/'t') */
  vimFindCharForward: (char: string, count: number, till: boolean) => void;
  /** Move to Nth occurrence of char backward on line; till=true stops after it (vim 'F'/'T') */
  vimFindCharBackward: (char: string, count: number, till: boolean) => void;
  /** Delete from cursor to Nth occurrence of char forward; till=true excludes the char (vim 'df'/'dt') */
  vimDeleteToCharForward: (char: string, count: number, till: boolean) => void;
  /** Delete from Nth occurrence of char backward to cursor; till=true excludes the char (vim 'dF'/'dT') */
  vimDeleteToCharBackward: (char: string, count: number, till: boolean) => void;
  /**
   * Enter insert mode at cursor (vim 'i' command)
   */
  vimInsertAtCursor: () => void;
  /**
   * Enter insert mode after cursor (vim 'a' command)
   */
  vimAppendAtCursor: () => void;
  /**
   * Open new line below and enter insert mode (vim 'o' command)
   */
  vimOpenLineBelow: () => void;
  /**
   * Open new line above and enter insert mode (vim 'O' command)
   */
  vimOpenLineAbove: () => void;
  /**
   * Move to end of line and enter insert mode (vim 'A' command)
   */
  vimAppendAtLineEnd: () => void;
  /**
   * Move to first non-whitespace and enter insert mode (vim 'I' command)
   */
  vimInsertAtLineStart: () => void;
  /**
   * Move cursor to beginning of line (vim '0' command)
   */
  vimMoveToLineStart: () => void;
  /**
   * Move cursor to end of line (vim '$' command)
   */
  vimMoveToLineEnd: () => void;
  /**
   * Move cursor to first non-whitespace character (vim '^' command)
   */
  vimMoveToFirstNonWhitespace: () => void;
  /**
   * Move cursor to first line (vim 'gg' command)
   */
  vimMoveToFirstLine: () => void;
  /**
   * Move cursor to last line (vim 'G' command)
   */
  vimMoveToLastLine: () => void;
  /**
   * Move cursor to specific line number (vim '[N]G' command)
   */
  vimMoveToLine: (lineNumber: number) => void;
  /**
   * Handle escape from insert mode (moves cursor left if not at line start)
   */
  vimEscapeInsertMode: () => void;
  /** Yank N lines into the unnamed register (vim 'yy' / 'Nyy') */
  vimYankLine: (count: number) => void;
  /** Yank forward N words into the unnamed register (vim 'yw') */
  vimYankWordForward: (count: number) => void;
  /** Yank forward N big words into the unnamed register (vim 'yW') */
  vimYankBigWordForward: (count: number) => void;
  /** Yank to end of N words into the unnamed register (vim 'ye') */
  vimYankWordEnd: (count: number) => void;
  /** Yank to end of N big words into the unnamed register (vim 'yE') */
  vimYankBigWordEnd: (count: number) => void;
  /** Yank from cursor to end of line into the unnamed register (vim 'y$') */
  vimYankToEndOfLine: (count: number) => void;
  /** Paste the unnamed register after cursor (vim 'p') */
  vimPasteAfter: (count: number) => void;
  /** Paste the unnamed register before cursor (vim 'P') */
  vimPasteBefore: (count: number) => void;
}

export type Direction = "left" | "right" | "up" | "down" | "home" | "end";

/**
 * Visual layout maps logical lines to visual (wrapped) lines.
 */
export interface VisualLayout {
  transformedToLogicalMaps: number[][];
  visualLines: string[];
  // For each logical line: an array of [visualLineIndex, startColInLogical]
  logicalToVisualMap: Array<Array<[number, number]>>;
  // For each visual line: [logicalLineIndex, startColInLogical]
  visualToLogicalMap: Array<[number, number]>;
  // For each visual line: [startColInTransformed]
  visualToTransformedMap: number[];
}

export interface TextBufferState {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
  preferredCol: number | null; // Used for vertical navigation
  undoStack: string[][];
  redoStack: string[][];
  viewportWidth: number;
  viewportHeight: number;
  visualScrollRow: number;
  visualLayout: VisualLayout;
}

type TextBufferAction =
  | { type: "INSERT"; payload: string; isPaste?: boolean }
  | {
    type: "SET_TEXT";
    payload: string;
    cursorPosition?: "start" | "end" | number;
  }
  | { type: "BACKSPACE" }
  | { type: "DELETE" }
  | { type: "NEWLINE" }
  | { type: "KILL_LINE_RIGHT" }
  | { type: "KILL_LINE_LEFT" }
  | { type: "DELETE_WORD_LEFT" }
  | { type: "DELETE_WORD_RIGHT" }
  | { type: "MOVE"; dir: Direction }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_VIEWPORT"; payload: { width: number; height: number } }
  | {
    type: "REPLACE_RANGE";
    payload: {
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
      text: string;
    };
  };

interface LineLayoutResult {
  visualLines: string[];
  logicalToVisualMap: Array<[number, number]>;
  visualToLogicalMap: Array<[number, number]>;
  transformedToLogMap: number[];
  visualToTransformedMap: number[];
}

const lineLayoutCache = new LRUCache<string, LineLayoutResult>(
  LRU_BUFFER_PERF_CACHE_LIMIT,
);

function getLineLayoutCacheKey(
  line: string,
  viewportWidth: number,
  isCursorOnLine: boolean,
  cursorCol: number,
): string {
  // Most lines (99.9% in a large buffer) are not cursor lines.
  // We use a simpler key for them to reduce string allocation overhead.
  if (!isCursorOnLine) {
    return `${viewportWidth}:N:${line}`;
  }
  return `${viewportWidth}:C:${cursorCol}:${line}`;
}

function calculateVisualCursorFromLayout(
  layout: VisualLayout,
  logicalCursor: [number, number],
): [number, number] {
  const { logicalToVisualMap, visualLines, transformedToLogicalMaps } = layout;
  const [logicalRow, logicalCol] = logicalCursor;

  const segmentsForLogicalLine = logicalToVisualMap[logicalRow];

  if (!segmentsForLogicalLine || segmentsForLogicalLine.length === 0) {
    // This can happen for an empty document.
    return [0, 0];
  }

  // Find the segment where the logical column fits.
  // The segments are sorted by startColInLogical.
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

  // If not found, it means the cursor is at the end of the logical line.
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
  const visualCol = clampedTransformedCol - startColInTransformed;
  const clampedVisualCol = Math.min(
    Math.max(visualCol, 0),
    cpLen(visualLines[visualRow] ?? ""),
  );
  return [visualRow, clampedVisualCol];
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

  const pushUndo = (_newLines: string[]): string[][] => {
    return [...state.undoStack, lines].slice(-100);
  };

  switch (action.type) {
    case "SET_VIEWPORT":
      return {
        ...state,
        viewportWidth: action.payload.width,
        viewportHeight: action.payload.height,
      };

    case "SET_TEXT": {
      const newLines = action.payload.replace(/\r\n/g, "\n").split("\n");
      const safeLines = newLines.length > 0 ? newLines : [""];

      let r = 0;
      let c = 0;

      if (action.cursorPosition === "end") {
        r = safeLines.length - 1;
        c = cpLen(safeLines[r]);
      } else if (typeof action.cursorPosition === "number") {
        [r, c] = offsetToLogicalPos(action.payload, action.cursorPosition);
      }

      return {
        ...state,
        lines: safeLines,
        cursorRow: r,
        cursorCol: c,
        preferredCol: null,
        undoStack: pushUndo(safeLines),
        redoStack: [],
      };
    }

    case "INSERT": {
      const payload = action.payload.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const parts = payload.split("\n");
      const newLines = [...lines];
      const before = cpSlice(currentLineText, 0, cursorCol);
      const after = cpSlice(currentLineText, cursorCol);

      let nextRow = cursorRow;
      let nextCol = cursorCol;

      if (parts.length === 1) {
        newLines[cursorRow] = before + parts[0] + after;
        nextCol = cursorCol + cpLen(parts[0]);
      } else {
        const firstLine = before + parts[0];
        const lastPart = parts[parts.length - 1];
        const lastLine = lastPart + after;
        const middle = parts.slice(1, -1);
        newLines.splice(cursorRow, 1, firstLine, ...middle, lastLine);
        nextRow = cursorRow + parts.length - 1;
        nextCol = cpLen(lastPart);
      }

      return {
        ...state,
        lines: newLines,
        cursorRow: nextRow,
        cursorCol: nextCol,
        preferredCol: null,
        undoStack: pushUndo(newLines),
        redoStack: [],
      };
    }

    case "NEWLINE": {
      const newLines = [...lines];
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
        undoStack: pushUndo(newLines),
        redoStack: [],
      };
    }

    case "BACKSPACE": {
      if (cursorCol === 0 && cursorRow === 0) return state;
      const newLines = [...lines];
      if (cursorCol > 0) {
        newLines[cursorRow] =
          cpSlice(currentLineText, 0, cursorCol - 1) +
          cpSlice(currentLineText, cursorCol);
        return {
          ...state,
          lines: newLines,
          cursorCol: cursorCol - 1,
          preferredCol: null,
          undoStack: pushUndo(newLines),
          redoStack: [],
        };
      } else {
        const prevLine = lines[cursorRow - 1];
        const prevLen = cpLen(prevLine);
        newLines[cursorRow - 1] = prevLine + currentLineText;
        newLines.splice(cursorRow, 1);
        return {
          ...state,
          lines: newLines,
          cursorRow: cursorRow - 1,
          cursorCol: prevLen,
          preferredCol: null,
          undoStack: pushUndo(newLines),
          redoStack: [],
        };
      }
    }

    case "DELETE": {
      if (cursorCol === cpLen(currentLineText) && cursorRow === lineCount - 1)
        return state;
      const newLines = [...lines];
      if (cursorCol < cpLen(currentLineText)) {
        newLines[cursorRow] =
          cpSlice(currentLineText, 0, cursorCol) +
          cpSlice(currentLineText, cursorCol + 1);
      } else {
        newLines[cursorRow] = currentLineText + lines[cursorRow + 1];
        newLines.splice(cursorRow + 1, 1);
      }
      return {
        ...state,
        lines: newLines,
        preferredCol: null,
        undoStack: pushUndo(newLines),
        redoStack: [],
      };
    }

    case "KILL_LINE_RIGHT": {
      const newLines = [...lines];
      newLines[cursorRow] = cpSlice(currentLineText, 0, cursorCol);
      return {
        ...state,
        lines: newLines,
        preferredCol: null,
        undoStack: pushUndo(newLines),
        redoStack: [],
      };
    }

    case "KILL_LINE_LEFT": {
      const newLines = [...lines];
      newLines[cursorRow] = cpSlice(currentLineText, cursorCol);
      return {
        ...state,
        lines: newLines,
        cursorCol: 0,
        preferredCol: null,
        undoStack: pushUndo(newLines),
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

      const newBefore = before.slice(0, i + 1);
      const newLines = [...lines];
      newLines[cursorRow] = newBefore + after;

      return {
        ...state,
        lines: newLines,
        cursorCol: cpLen(newBefore),
        preferredCol: null,
        undoStack: pushUndo(newLines),
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

      const newAfter = after.slice(i);
      const newLines = [...lines];
      newLines[cursorRow] = before + newAfter;

      return {
        ...state,
        lines: newLines,
        preferredCol: null,
        undoStack: pushUndo(newLines),
        redoStack: [],
      };
    }

    case "MOVE": {
      const { dir } = action;
      const { visualLayout, preferredCol } = state;
      const visualCursor = calculateVisualCursorFromLayout(visualLayout, [
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

      // Up/Down movement (visual-based)
      let newVisRow = visualCursor[0];
      let newVisCol = visualCursor[1];
      let newPrefCol = preferredCol;

      if (dir === "up" && newVisRow > 0) {
        if (newPrefCol === null) newPrefCol = newVisCol;
        newVisRow--;
        newVisCol = Math.min(
          newPrefCol,
          cpLen(visualLayout.visualLines[newVisRow] ?? ""),
        );
      } else if (
        dir === "down" &&
        newVisRow < visualLayout.visualLines.length - 1
      ) {
        if (newPrefCol === null) newPrefCol = newVisCol;
        newVisRow++;
        newVisCol = Math.min(
          newPrefCol,
          cpLen(visualLayout.visualLines[newVisRow] ?? ""),
        );
      } else {
        return state;
      }

      const mapping = visualLayout.visualToLogicalMap[newVisRow];
      if (mapping) {
        return {
          ...state,
          cursorRow: mapping[0],
          cursorCol: mapping[1] + newVisCol,
          preferredCol: newPrefCol,
        };
      }
      return state;
    }

    case "REPLACE_RANGE": {
      const { startRow, startCol, endRow, endCol, text } = action.payload;
      const newLines = [...lines];

      const prefix = cpSlice(lines[startRow] || "", 0, startCol);
      const suffix = cpSlice(lines[endRow] || "", endCol);

      const replacementParts = text.replace(/\r\n/g, "\n").split("\n");
      const firstPart = prefix + replacementParts[0];
      const lastPart = replacementParts[replacementParts.length - 1] + suffix;

      if (replacementParts.length === 1) {
        newLines.splice(startRow, endRow - startRow + 1, firstPart + suffix);
      } else {
        const middleParts = replacementParts.slice(1, -1);
        newLines.splice(
          startRow,
          endRow - startRow + 1,
          firstPart,
          ...middleParts,
          lastPart,
        );
      }

      return {
        ...state,
        lines: newLines,
        cursorRow: startRow + replacementParts.length - 1,
        cursorCol: cpLen(replacementParts[replacementParts.length - 1]),
        preferredCol: null,
        undoStack: pushUndo(newLines),
        redoStack: [],
      };
    }

    case "UNDO": {
      if (state.undoStack.length === 0) return state;
      const prevLines = state.undoStack[state.undoStack.length - 1];
      return {
        ...state,
        lines: prevLines,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, lines],
        cursorRow: Math.max(0, prevLines.length - 1),
        cursorCol: cpLen(prevLines[prevLines.length - 1] || ""),
        preferredCol: null,
      };
    }

    case "REDO": {
      if (state.redoStack.length === 0) return state;
      const nextLines = state.redoStack[state.redoStack.length - 1];
      return {
        ...state,
        lines: nextLines,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, lines],
        cursorRow: Math.max(0, nextLines.length - 1),
        cursorCol: cpLen(nextLines[nextLines.length - 1] || ""),
        preferredCol: null,
      };
    }

    default:
      return state;
  }
}

export interface Transformation {
  logStart: number;
  logEnd: number;
  logicalText: string;
  collapsedText: string;
  type: "image" | "paste";
  id?: string; // For paste placeholders
}

const transformationsCache = new LRUCache<string, Transformation[]>(
  LRU_BUFFER_PERF_CACHE_LIMIT,
);

export function calculateTransformationsForLine(
  line: string,
): Transformation[] {
  const cached = transformationsCache.get(line);
  if (cached) {
    return cached;
  }
  const transformations: Transformation[] = [];

  // 2. Detect paste placeholders
  const pasteRegex = new RegExp(PASTED_TEXT_PLACEHOLDER_REGEX.source, "g");

  const match = pasteRegex.exec(line);
  while (match !== null) {
    const logicalText = match[0];
    const logStart = cpLen(line.substring(0, match.index));
    const logEnd = logStart + cpLen(logicalText);

    transformations.push({
      logStart,
      logEnd,
      logicalText,
      collapsedText: logicalText,
      type: "paste",
      id: logicalText,
    });
  }

  // Sort transformations by logStart to maintain consistency
  transformations.sort((a, b) => a.logStart - b.logStart);
  transformationsCache.set(line, transformations);

  return transformations;
}

export function calculateTransformedLine(
  logLine: string,
  logIndex: number,
  logicalCursor: [number, number],
  transformations: Transformation[],
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
      transform.type === "image" &&
      cursorIsOnThisLine &&
      cursorCol >= transform.logStart &&
      cursorCol <= transform.logEnd;
    const transformedText = isExpanded
      ? transform.logicalText
      : transform.collapsedText;
    transformedLine += transformedText;

    // Map transformed characters back to logical characters
    const transformedLen = cpLen(transformedText);
    if (isExpanded) {
      for (let i = 0; i < transformedLen; i++) {
        transformedToLogMap.push(transform.logStart + i);
      }
    } else {
      // Collapsed: distribute transformed positions monotonically across the raw span.
      // This preserves ordering across wrapped slices so logicalToVisualMap has
      // increasing startColInLogical and visual cursor mapping remains consistent.
      const logicalLength = Math.max(0, transform.logEnd - transform.logStart);
      for (let i = 0; i < transformedLen; i++) {
        // Map the i-th transformed code point into [logStart, logEnd)
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
function calculateLayout(
  logicalLines: string[],
  viewportWidth: number,
  logicalCursor: [number, number],
): VisualLayout {
  const visualLines: string[] = [];
  const logicalToVisualMap: Array<Array<[number, number]>> = [];
  const visualToLogicalMap: Array<[number, number]> = [];
  const transformedToLogicalMaps: number[][] = [];
  const visualToTransformedMap: number[] = [];

  logicalLines.forEach((logLine, logIndex) => {
    logicalToVisualMap[logIndex] = [];

    const isCursorOnLine = logIndex === logicalCursor[0];
    const cacheKey = getLineLayoutCacheKey(
      logLine,
      viewportWidth,
      isCursorOnLine,
      logicalCursor[1],
    );
    const cached = lineLayoutCache.get(cacheKey);

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

    // Not in cache, calculate
    const transformations = calculateTransformationsForLine(logLine);
    const { transformedLine, transformedToLogMap } = calculateTransformedLine(
      logLine,
      logIndex,
      logicalCursor,
      transformations,
    );

    const lineVisualLines: string[] = [];
    const lineLogicalToVisualMap: Array<[number, number]> = [];
    const lineVisualToLogicalMap: Array<[number, number]> = [];
    const lineVisualToTransformedMap: number[] = [];

    if (transformedLine.length === 0) {
      // Handle empty logical line
      lineLogicalToVisualMap.push([0, 0]);
      lineVisualToLogicalMap.push([logIndex, 0]);
      lineVisualToTransformedMap.push(0);
      lineVisualLines.push("");
    } else {
      // Non-empty logical line
      let currentPosInLogLine = 0; // Tracks position within the current logical line (code point index)
      const codePointsInLogLine = toCodePoints(transformedLine);

      while (currentPosInLogLine < codePointsInLogLine.length) {
        let currentChunk = "";
        let currentChunkVisualWidth = 0;
        let numCodePointsInChunk = 0;
        let lastWordBreakPoint = -1; // Index in codePointsInLogLine for word break
        let numCodePointsAtLastWordBreak = 0;

        // Iterate through code points to build the current visual line (chunk)
        for (let i = currentPosInLogLine; i < codePointsInLogLine.length; i++) {
          const char = codePointsInLogLine[i];
          const charVisualWidth = getCachedStringWidth(char);

          if (currentChunkVisualWidth + charVisualWidth > viewportWidth) {
            // Character would exceed viewport width
            if (
              lastWordBreakPoint !== -1 &&
              numCodePointsAtLastWordBreak > 0 &&
              currentPosInLogLine + numCodePointsAtLastWordBreak < i
            ) {
              // We have a valid word break point to use, and it's not the start of the current segment
              currentChunk = codePointsInLogLine
                .slice(
                  currentPosInLogLine,
                  currentPosInLogLine + numCodePointsAtLastWordBreak,
                )
                .join("");
              numCodePointsInChunk = numCodePointsAtLastWordBreak;
            } else {
              // No word break, or word break is at the start of this potential chunk, or word break leads to empty chunk.
              // Hard break: take characters up to viewportWidth, or just the current char if it alone is too wide.
              if (
                numCodePointsInChunk === 0 &&
                charVisualWidth > viewportWidth
              ) {
                // Single character is wider than viewport, take it anyway
                currentChunk = char;
                numCodePointsInChunk = 1;
              }
            }
            break; // Break from inner loop to finalize this chunk
          }

          currentChunk += char;
          currentChunkVisualWidth += charVisualWidth;
          numCodePointsInChunk++;

          // Check for word break opportunity (space)
          if (char === " ") {
            lastWordBreakPoint = i; // Store code point index of the space
            // Store the state *before* adding the space, if we decide to break here.
            numCodePointsAtLastWordBreak = numCodePointsInChunk - 1; // Chars *before* the space
          }
        }

        if (
          numCodePointsInChunk === 0 &&
          currentPosInLogLine < codePointsInLogLine.length
        ) {
          const firstChar = codePointsInLogLine[currentPosInLogLine];
          currentChunk = firstChar;
          numCodePointsInChunk = 1;
        }

        const logicalStartCol = transformedToLogMap[currentPosInLogLine] ?? 0;
        lineLogicalToVisualMap.push([lineVisualLines.length, logicalStartCol]);
        lineVisualToLogicalMap.push([logIndex, logicalStartCol]);
        lineVisualToTransformedMap.push(currentPosInLogLine);
        lineVisualLines.push(currentChunk);

        const logicalStartOfThisChunk = currentPosInLogLine;
        currentPosInLogLine += numCodePointsInChunk;

        if (
          logicalStartOfThisChunk + numCodePointsInChunk <
          codePointsInLogLine.length &&
          currentPosInLogLine < codePointsInLogLine.length &&
          codePointsInLogLine[currentPosInLogLine] === " "
        ) {
          currentPosInLogLine++;
        }
      }
    }

    // Cache the result for this line
    lineLayoutCache.set(cacheKey, {
      visualLines: lineVisualLines,
      logicalToVisualMap: lineLogicalToVisualMap,
      visualToLogicalMap: lineVisualToLogicalMap,
      transformedToLogMap,
      visualToTransformedMap: lineVisualToTransformedMap,
    });

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

function textBufferReducer(
  state: TextBufferState,
  action: TextBufferAction,
): TextBufferState {
  let newState = bufferReducerLogic(state, action);

  // Recalculate layout if lines or width changed
  if (
    newState.lines !== state.lines ||
    newState.viewportWidth !== state.viewportWidth
  ) {
    newState = {
      ...newState,
      visualLayout: calculateLayout(newState.lines, newState.viewportWidth, [
        newState.cursorRow,
        newState.cursorCol,
      ]),
    };
  }

  // Handle scrolling (Vertical scroll-into-view)
  const visualCursor = calculateVisualCursorFromLayout(newState.visualLayout, [
    newState.cursorRow,
    newState.cursorCol,
  ]);
  const cursorVisRow = visualCursor[0];

  let newScrollRow = newState.visualScrollRow;
  if (cursorVisRow < newScrollRow) {
    newScrollRow = cursorVisRow;
  } else if (cursorVisRow >= newScrollRow + newState.viewportHeight) {
    newScrollRow = cursorVisRow - newState.viewportHeight + 1;
  }

  // Clamp scroll row
  const maxScroll = Math.max(
    0,
    newState.visualLayout.visualLines.length - newState.viewportHeight,
  );
  newScrollRow = Math.min(Math.max(newScrollRow, 0), maxScroll);

  if (newScrollRow !== newState.visualScrollRow) {
    newState = { ...newState, visualScrollRow: newScrollRow };
  }

  return newState;
}

/**
 * A simplified multi-line text buffer hook with viewport management.
 */
export function useTextBuffer({
  initialText = "",
  viewportWidth = 80,
  viewportHeight = 10,
}: {
  initialText: string;
  viewportWidth: number;
  viewportHeight: number;
}) {
  const initialState = useMemo((): TextBufferState => {
    const lines = initialText.replace(/\r\n/g, "\n").split("\n");
    const safeLines = lines.length === 0 ? [""] : lines;
    const layout = calculateLayout(safeLines, viewportWidth, [0, 0]);
    return {
      lines: safeLines,
      cursorRow: 0,
      cursorCol: 0,
      preferredCol: null,
      undoStack: [],
      redoStack: [],
      viewportWidth,
      viewportHeight,
      visualScrollRow: 0,
      visualLayout: layout,
    };
  }, [initialText, viewportWidth, viewportHeight]);

  const [state, dispatch] = useReducer(textBufferReducer, initialState);

  useEffect(() => {
    dispatch({
      type: "SET_VIEWPORT",
      payload: { width: viewportWidth, height: viewportHeight },
    });
  }, [viewportWidth, viewportHeight]);

  const insert = useCallback(
    (text: string, opts?: { paste?: boolean }) =>
      dispatch({ type: "INSERT", payload: text, isPaste: opts?.paste }),
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

  const handleInput = useCallback(
    (key: Key): boolean => {
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

      // Handle character input (only insertable printable characters)
      if (key.insertable && key.sequence) {
        insert(key.sequence);
        return true;
      }

      return false;
    },
    [backspace, deleteChar, move, insert],
  );

  const visualCursor = useMemo(
    () =>
      calculateVisualCursorFromLayout(state.visualLayout, [
        state.cursorRow,
        state.cursorCol,
      ]),
    [state.visualLayout, state.cursorRow, state.cursorCol],
  );

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

  const noop = useCallback(() => { }, []);
  const noopCount = useCallback((_count: number) => { }, []);
  const noopAsync = useCallback(async () => { }, []);

  return useMemo(
    () => ({
      lines: state.lines,
      text: state.lines.join("\n"),
      cursor: [state.cursorRow, state.cursorCol] as [number, number],
      preferredCol: state.preferredCol,
      selectionAnchor: null,
      pastedContent: {},

      // Visual / Viewport properties
      allVisualLines: state.visualLayout.visualLines,
      viewportVisualLines,
      visualCursor,
      visualScrollRow: state.visualScrollRow,
      viewportHeight: state.viewportHeight,
      visualToLogicalMap: state.visualLayout.visualToLogicalMap,
      transformedToLogicalMaps: state.visualLayout.transformedToLogicalMaps,
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

      // Advanced actions (stubs — not yet implemented in this buffer)
      openInExternalEditor: noopAsync,
      replaceRangeByOffset: (_s: number, _e: number, _t: string) => { },
      moveToOffset: (_offset: number) => { },
      moveToVisualPosition: (_vr: number, _vc: number) => { },
      getLogicalPositionFromVisual: (_vr: number, _vc: number) => null,
      getExpandedPasteAtLine: (_lineIndex: number) => null,
      togglePasteExpansion: (_id: string, _row: number, _col: number) => { },

      // Vim stubs
      vimDeleteWordForward: noopCount,
      vimDeleteWordBackward: noopCount,
      vimDeleteWordEnd: noopCount,
      vimDeleteBigWordForward: noopCount,
      vimDeleteBigWordBackward: noopCount,
      vimDeleteBigWordEnd: noopCount,
      vimChangeWordForward: noopCount,
      vimChangeWordBackward: noopCount,
      vimChangeWordEnd: noopCount,
      vimChangeBigWordForward: noopCount,
      vimChangeBigWordBackward: noopCount,
      vimChangeBigWordEnd: noopCount,
      vimDeleteLine: noopCount,
      vimChangeLine: noopCount,
      vimDeleteToEndOfLine: (_count?: number) => { },
      vimDeleteToStartOfLine: noop,
      vimChangeToEndOfLine: (_count?: number) => { },
      vimDeleteToFirstNonWhitespace: noop,
      vimChangeToStartOfLine: noop,
      vimChangeToFirstNonWhitespace: noop,
      vimDeleteToFirstLine: noopCount,
      vimDeleteToLastLine: noopCount,
      vimChangeMovement: (_m: "h" | "j" | "k" | "l", _count: number) => { },
      vimMoveLeft: noopCount,
      vimMoveRight: noopCount,
      vimMoveUp: noopCount,
      vimMoveDown: noopCount,
      vimMoveWordForward: noopCount,
      vimMoveWordBackward: noopCount,
      vimMoveWordEnd: noopCount,
      vimMoveBigWordForward: noopCount,
      vimMoveBigWordBackward: noopCount,
      vimMoveBigWordEnd: noopCount,
      vimDeleteChar: noopCount,
      vimDeleteCharBefore: noopCount,
      vimToggleCase: noopCount,
      vimReplaceChar: (_char: string, _count: number) => { },
      vimFindCharForward: (_char: string, _count: number, _till: boolean) => { },
      vimFindCharBackward: (
        _char: string,
        _count: number,
        _till: boolean,
      ) => { },
      vimDeleteToCharForward: (
        _char: string,
        _count: number,
        _till: boolean,
      ) => { },
      vimDeleteToCharBackward: (
        _char: string,
        _count: number,
        _till: boolean,
      ) => { },
      vimInsertAtCursor: noop,
      vimAppendAtCursor: noop,
      vimOpenLineBelow: noop,
      vimOpenLineAbove: noop,
      vimAppendAtLineEnd: noop,
      vimInsertAtLineStart: noop,
      vimMoveToLineStart: noop,
      vimMoveToLineEnd: noop,
      vimMoveToFirstNonWhitespace: noop,
      vimMoveToFirstLine: noop,
      vimMoveToLastLine: noop,
      vimMoveToLine: noopCount,
      vimEscapeInsertMode: noop,
      vimYankLine: noopCount,
      vimYankWordForward: noopCount,
      vimYankBigWordForward: noopCount,
      vimYankWordEnd: noopCount,
      vimYankBigWordEnd: noopCount,
      vimYankToEndOfLine: noopCount,
      vimPasteAfter: noopCount,
      vimPasteBefore: noopCount,
    }),
    [
      state,
      viewportVisualLines,
      visualCursor,
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
      noop,
      noopCount,
      noopAsync,
    ],
  );
}
