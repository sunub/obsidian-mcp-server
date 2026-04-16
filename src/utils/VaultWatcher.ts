import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { ragIndexer } from "./RAGIndexer.js";
import { vectorDB } from "./VectorDB.js";

export class VaultWatcher {
	private watcher: FSWatcher | null = null;
	private initialScanDone = false;
	/** true일 경우 초기 스캔에서 모든 파일을 재인덱싱 (버전 변경 시) */
	private forceReindex = false;

	async start(vaultPath: string) {
		if (this.watcher) {
			await this.watcher.close();
		}

		this.initialScanDone = false;

		// 인덱스 버전/모델 체크 → 불일치 시 전체 재인덱싱 플래그 설정
		this.forceReindex = await vectorDB.checkAndMigrateIfNeeded();
		if (this.forceReindex) {
			console.error(
				"[VaultWatcher] Index version changed — all files will be re-indexed on this startup.",
			);
		}

		console.error(`Starting Vault Watcher for RAG sync: ${vaultPath}`);

		this.watcher = chokidar.watch(vaultPath, {
			ignored: [
				/(^|[/\\])\../, // Dotfiles
				"**/node_modules/**",
				"**/.obsidian/**",
			],
			persistent: true,
			ignoreInitial: false,
		});

		this.watcher
			.on("add", async (filePath: string) => {
				if (this.isMarkdown(filePath)) {
					// 초기 스캔 중: forceReindex가 아닌 경우 이미 인덱싱된 파일은 건너뜀
					if (!this.initialScanDone && !this.forceReindex) {
						const exists = await vectorDB.hasFile(filePath);
						if (exists) {
							return;
						}
					}
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
			})
			.on("ready", () => {
				this.initialScanDone = true;
				this.forceReindex = false;
				console.error("Vault Watcher initial scan complete.");
			});

		this.watcher.on("error", (error: any) => {
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
