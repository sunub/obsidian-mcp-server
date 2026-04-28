export enum CommandKind {
	BUILT_IN = "built-in",
	USER_FILE = "user-file",
	WORKSPACE_FILE = "workspace-file",
	EXTENSION_FILE = "extension-file",
	MCP_PROMPT = "mcp-prompt",
	AGENT = "agent",
	SKILL = "skill",
}

export interface SlashCommand {
	name: string;
	description?: string;
	action?: (args: string) => void | Promise<void>;
	completion?: (query: string) => Promise<string[]>;
	subcommands?: SlashCommand[];
}

export interface CommandContext {
	[key: string]: unknown;
}
