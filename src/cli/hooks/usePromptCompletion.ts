import type React from "react";
import type { TextBuffer } from "../key/text-buffer.js";
import type { Suggestion } from "../ui/SuggestionsDisplay.js";

export const PROMPT_COMPLETION_MIN_LENGTH = 3;

export interface PromptCompletion {
	text: string;
	isActive: boolean;
	isLoading: boolean;
	accept: () => void;
	clear: () => void;
	markSelected: () => void;
}

export interface UsePromptCompletionOptions {
	buffer: TextBuffer;
	setSuggestions?: React.Dispatch<React.SetStateAction<Suggestion[]>>;
	setIsLoadingSuggestions?: React.Dispatch<React.SetStateAction<boolean>>;
}

/** Stub: Prompt (history/MCP) completion. */
export function usePromptCompletion(
	_options: UsePromptCompletionOptions,
): PromptCompletion {
	return {
		text: "",
		isActive: false,
		isLoading: false,
		accept: () => {},
		clear: () => {},
		markSelected: () => {},
	};
}
