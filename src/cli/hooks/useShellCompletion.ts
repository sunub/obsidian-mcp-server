import type React from "react";
import type { Suggestion } from "../ui/SuggestionsDisplay.js";

export interface UseShellCompletionOptions {
	enabled: boolean;
	line: string;
	cursorCol: number;
	cwd: string;
	setSuggestions: React.Dispatch<React.SetStateAction<Suggestion[]>>;
	setIsLoadingSuggestions: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface ShellCompletionRange {
	query: string | null;
	completionStart: number;
	completionEnd: number;
	activeStart: number;
}

/** Stub: Shell path/command completion. */
export function useShellCompletion(
	_options: UseShellCompletionOptions,
): ShellCompletionRange {
	return {
		query: null,
		completionStart: -1,
		completionEnd: -1,
		activeStart: -1,
	};
}
