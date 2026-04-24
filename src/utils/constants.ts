import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const APP_DATA_DIR = join(homedir(), ".obsidian-mcp-server");
export const MODELS_DIR = join(APP_DATA_DIR, "models");

export function ensureAppDataDirs() {
	if (!existsSync(APP_DATA_DIR)) {
		mkdirSync(APP_DATA_DIR, { recursive: true });
	}
	if (!existsSync(MODELS_DIR)) {
		mkdirSync(MODELS_DIR, { recursive: true });
	}
}
