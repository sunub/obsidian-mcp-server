import { createContext, useContext } from "react";
import type { HistoryItem, StreamingState } from "../types.js";
import type { TransientMessageType } from "../utils/events.js";

export interface TransientMessage {
	text: string;
	type: TransientMessageType;
}

export interface UIState {
	history: HistoryItem[];
	streamingState: StreamingState;
	terminalWidth: number;
	terminalHeight: number;
	isInputActive: boolean;
	transientMessage: TransientMessage | null;
}

export const UIStateContext = createContext<UIState | null>(null);

export const useUIState = () => {
	const context = useContext(UIStateContext);
	if (!context) {
		throw new Error("useUIState must be used within a UIStateProvider");
	}
	return context;
};
