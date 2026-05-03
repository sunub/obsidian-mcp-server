export type Direction = "left" | "right" | "up" | "down" | "home" | "end";

export interface VisualLayout {
	transformedToLogicalMaps: number[][];
	visualLines: string[];
	logicalToVisualMap: Array<Array<[number, number]>>;
	visualToLogicalMap: Array<[number, number]>;
	visualToTransformedMap: number[];
}

export interface ExpandedPasteInfo {
	id: string;
	startLine: number;
	lineCount: number;
	prefix: string;
	suffix: string;
}

export interface TextBufferState {
	lines: string[];
	cursorRow: number;
	cursorCol: number;
	preferredCol: number | null;
	undoStack: UndoHistoryEntry[];
	redoStack: UndoHistoryEntry[];
	viewportWidth: number;
	viewportHeight: number;
	visualScrollRow: number;
	visualLayout: VisualLayout;
	pastedContent: Record<string, string>;
	expandedPaste: ExpandedPasteInfo | null;
	transformationsByLine: Transformation[][];
}

export type TextBufferAction =
	| { type: "INSERT"; payload: string; isPaste?: boolean }
	| {
			type: "SET_TEXT";
			payload: string;
			pushToUndo?: boolean;
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
	  }
	| {
			type: "TOGGLE_PASTE_EXPANSION";
			payload: {
				id: string;
				row: number;
				col: number;
			};
	  };

export interface LineLayoutResult {
	visualLines: string[];
	logicalToVisualMap: Array<[number, number]>;
	visualToLogicalMap: Array<[number, number]>;
	transformedToLogMap: number[];
	visualToTransformedMap: number[];
}

export interface Transformation {
	logStart: number;
	logEnd: number;
	logicalText: string;
	collapsedText: string;
	expandedText?: string;
	type: "image" | "paste";
	id?: string; // For paste placeholders
}

export interface UndoHistoryEntry {
	lines: string[];
	cursorRow: number;
	cursorCol: number;
	pastedContent: Record<string, string>;
	expandedPaste: ExpandedPasteInfo | null;
}
