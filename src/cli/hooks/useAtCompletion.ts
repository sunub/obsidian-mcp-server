import type { Suggestion } from "@cli/ui/SuggestionsDisplay.js";
import type React from "react";

export interface UseAtCompletionOptions {
	enabled: boolean;
	pattern: string;
	config?: Record<string, unknown>;
	cwd: string;
	setSuggestions: React.Dispatch<React.SetStateAction<Suggestion[]>>;
	setIsLoadingSuggestions: React.Dispatch<React.SetStateAction<boolean>>;
}

/** Stub: File/path completion for @-mentions. */
export function useAtCompletion(_options: UseAtCompletionOptions): void {
	// Stub implementation — expand when file completion is needed.
}
