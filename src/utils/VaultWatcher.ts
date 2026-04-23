import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { getGlobalVaultManager } from "./getVaultManager.js";
import type { VaultManager } from "./VaultManger/VaultManager.js";

export class VaultWatcher {
	private watcher: FSWatcher | null = null;
	private vaultManager: VaultManager | null = null;

	async start(vaultPath: string) {
		if (this.watcher) {
			await this.watcher.close();
		}

		if (!this.vaultManager) {
			this.vaultManager = getGlobalVaultManager();
		}

		await this.vaultManager.initialize();
		await this.vaultManager.syncMissingRagIndices();

		console.error(`Starting Vault Watcher for real-time sync: ${vaultPath}`);
		this.watcher = chokidar.watch(vaultPath, {
			ignored: [/(^|[/\\])\../, "**/node_modules/**", "**/.obsidian/**"],
			persistent: true,
			ignoreInitial: true,
		});

		this.watcher
			.on("add", async (filePath: string) => {
				if (this.isMarkdown(filePath)) {
					console.error(`File added: ${filePath}`);
					await this.vaultManager?.upsertDocument(filePath);
				}
			})
			.on("change", async (filePath: string) => {
				if (this.isMarkdown(filePath)) {
					console.error(`File changed: ${filePath}`);
					await this.vaultManager?.upsertDocument(filePath);
				}
			})
			.on("unlink", async (filePath: string) => {
				if (this.isMarkdown(filePath)) {
					console.error(`File deleted: ${filePath}`);
					await this.vaultManager?.removeDocument(filePath);
				}
			});

		this.watcher.on("error", (error: unknown) => {
			console.error(`Watcher error: ${error}`);
		});
	}

	async stop() {
		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
	}

	private isMarkdown(filePath: string): boolean {
		const ext = path.extname(filePath).toLowerCase();
		return ext === ".md" || ext === ".mdx";
	}
}

export const vaultWatcher = new VaultWatcher();
