import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { debugLogger } from "@/shared/index.js";

const HISTORY_FILE_PATH = path.join(
	os.homedir(),
	".obsidian-mcp-agent-history.json",
);
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface HistoryItem {
	text: string;
	timestamp: number;
}

export class HistoryStorage {
	private filePath: string;

	constructor(filePath: string = HISTORY_FILE_PATH) {
		this.filePath = filePath;
	}

	async getPreviousUserMessages(): Promise<string[]> {
		try {
			const data = await fs.readFile(this.filePath, "utf-8");
			const parsed: HistoryItem[] = JSON.parse(data);
			const now = Date.now();

			const validItems = parsed.filter(
				(item) => now - item.timestamp <= EXPIRY_MS,
			);

			// If items were pruned, save back to file to save disk space
			if (validItems.length < parsed.length) {
				await this.saveItems(validItems);
			}

			// Return just the text values
			return validItems.map((item) => item.text);
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				debugLogger.warn("Failed to read history storage", error);
			}
			return [];
		}
	}

	async appendMessage(text: string): Promise<void> {
		try {
			const currentMessages = await this.getRawItems();
			const now = Date.now();

			// Prune old items first
			const validItems = currentMessages.filter(
				(item) => now - item.timestamp <= EXPIRY_MS,
			);
			validItems.push({ text, timestamp: now });

			await this.saveItems(validItems);
		} catch (error) {
			debugLogger.warn("Failed to append message to history storage", error);
		}
	}

	private async getRawItems(): Promise<HistoryItem[]> {
		try {
			const data = await fs.readFile(this.filePath, "utf-8");
			return JSON.parse(data);
		} catch (_error) {
			return [];
		}
	}

	private async saveItems(items: HistoryItem[]): Promise<void> {
		try {
			await fs.writeFile(
				this.filePath,
				JSON.stringify(items, null, 2),
				"utf-8",
			);
		} catch (error) {
			debugLogger.warn("Failed to save items to history storage", error);
		}
	}
}

export const historyStorage = new HistoryStorage();
