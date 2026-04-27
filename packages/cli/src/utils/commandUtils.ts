/**
 * Utility functions for command parsing.
 */

/**
 * Returns true if the trimmed text begins with '/', indicating a slash command.
 */
export function isSlashCommand(text: string): boolean {
	return text.trimStart().startsWith("/");
}

/**
 * Returns true if the trimmed text begins with '@', indicating an at-command.
 */
export function isAtCommand(text: string): boolean {
	return text.trimStart().startsWith("@");
}
