import type { TextBuffer } from "@cli/key/textBuffer/index.js";
import { createContext, useContext } from "react";

export interface InputState {
	buffer: TextBuffer;
	userMessages: string[];
	shellModeActive: boolean;
	showEscapePrompt: boolean;
	copyModeEnabled: boolean | undefined;
	inputWidth: number;
	suggestionsWidth: number;
}

export const InputContext = createContext<InputState | null>(null);

export const useInputState = () => {
	const context = useContext(InputContext);
	if (!context) {
		throw new Error("useInputState must be used within an InputProvider");
	}
	return context;
};
