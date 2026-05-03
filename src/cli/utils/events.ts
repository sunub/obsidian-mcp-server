import { EventEmitter } from "node:events";

export enum TransientMessageType {
	Warning = "warning",
	Hint = "hint",
}

export interface TransientMessagePayload {
	message: string;
	type: TransientMessageType;
}

export enum AppEvent {
	OpenDebugConsole = "open-debug-console",
	Flicker = "flicker",
	SelectionWarning = "selection-warning",
	PasteTimeout = "paste-timeout",
	TerminalBackground = "terminal-background",
	TransientMessage = "transient-message",
	ScrollToBottom = "scroll-to-bottom",
}

export interface AppEvents {
	[AppEvent.OpenDebugConsole]: [string];
	[AppEvent.Flicker]: never[];
	[AppEvent.SelectionWarning]: never[];
	[AppEvent.PasteTimeout]: never[];
	[AppEvent.TerminalBackground]: [string];
	[AppEvent.TransientMessage]: [TransientMessagePayload];
	[AppEvent.ScrollToBottom]: never[];
}

export const appEvents = new EventEmitter<AppEvents>();
