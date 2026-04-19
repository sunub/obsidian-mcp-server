import type React from "react";
import type { Suggestion } from "../ui/SuggestionsDisplay.js";
import type { CommandContext, SlashCommand } from "../commands/types.js";

export interface UseSlashCompletionOptions {
	enabled: boolean;
	query: string | null;
	slashCommands: readonly SlashCommand[];
	commandContext: CommandContext;
	setSuggestions: React.Dispatch<React.SetStateAction<Suggestion[]>>;
	setIsLoadingSuggestions: React.Dispatch<React.SetStateAction<boolean>>;
	setIsPerfectMatch: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface SlashCompletionRange {
	completionStart: number;
	completionEnd: number;
	getCommandFromSuggestion: (suggestion: Suggestion) => SlashCommand | undefined;
	isArgumentCompletion: boolean;
	leafCommand: SlashCommand | null;
}

/** Stub: Slash-command completion. */
export function useSlashCompletion(
	_options: UseSlashCompletionOptions,
): SlashCompletionRange {
	return {
		completionStart: -1,
		completionEnd: -1,
		getCommandFromSuggestion: () => undefined,
		isArgumentCompletion: false,
		leafCommand: null,
	};
}
