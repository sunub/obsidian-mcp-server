import fs from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { ragIndexer } from "./RAGIndexer.js";
import { vectorDB } from "./VectorDB.js";
import { DirectoryWalker } from "./DirectoryWalker.js";
import { Semaphore } from "./semaphore.js";

export class VaultWatcher {
	private watcher: FSWatcher | null = null;
	private forceReindex = false;

	async start(vaultPath: string) {
		if (this.watcher) {
			await this.watcher.close();
		}

		this.forceReindex = await vectorDB.checkAndMigrateIfNeeded();
		if (this.forceReindex) {
			console.error(
				"[VaultWatcher] Index version changed — all files will be re-indexed on this startup.",
			);
		}

		const walker = new DirectoryWalker();
		const ioSemaphore = new Semaphore(10);
		const allFiles = await walker.walk(vaultPath, ioSemaphore);
		const markdownFiles = allFiles.filter((f) => this.isMarkdown(f));

		const filesToProcess: string[] = [];
		for (const filePath of markdownFiles) {
			if (this.forceReindex) {
				filesToProcess.push(filePath);
			} else {
				const stats = await fs.stat(filePath);
				const storedMtime = await vectorDB.getFileMtime(filePath);
				if (storedMtime !== stats.mtime.toISOString()) {
					filesToProcess.push(filePath);
				}
			}
		}

		if (filesToProcess.length > 0) {
			console.error(
				`[VaultWatcher] Found ${filesToProcess.length} files to index.`,
			);
			ragIndexer.setSpinner(filesToProcess.length);
			for (const filePath of filesToProcess) {
				await ragIndexer.processFile(filePath);
			}
			await vectorDB.createVectorIndex();
		} else {
			console.error("[VaultWatcher] No files need indexing.");
		}

		this.forceReindex = false;

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
					await ragIndexer.processFile(filePath);
				}
			})
			.on("change", async (filePath: string) => {
				if (this.isMarkdown(filePath)) {
					console.error(`File changed: ${filePath}`);
					await ragIndexer.processFile(filePath);
				}
			})
			.on("unlink", async (filePath: string) => {
				if (this.isMarkdown(filePath)) {
					console.error(`File deleted: ${filePath}`);
					await ragIndexer.deleteFile(filePath);
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
