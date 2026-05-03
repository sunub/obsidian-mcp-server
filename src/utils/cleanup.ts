import { appendFileSync, existsSync, promises as fs } from "node:fs";
import path from "node:path";
import state from "@/config.js";
import { debugLogger } from "@/shared/index.js";
import { APP_DATA_DIR } from "./constants.js";

export const ExitCodes = {
	SUCCESS: 0,
	FATAL_AUTHENTICATION_ERROR: 41,
	FATAL_INPUT_ERROR: 42,
	FATAL_CONFIG_ERROR: 52,
	FATAL_CANCELLATION_ERROR: 130,
} as const;

type CleanupTask = () => Promise<void> | void;

interface RegisteredTask {
	name: string;
	task: CleanupTask;
}

class CleanupManager {
	private tasks: RegisteredTask[] = [];
	private isShuttingDown = false;
	private softAbortHandler: (() => void) | null = null;
	private lastSigInt = 0;

	register(name: string, task: CleanupTask) {
		this.tasks.push({ name, task });
		debugLogger.writeDebug(`[CleanupManager] Registered task: ${name}`);
	}

	registerSoftAbort(handler: () => void) {
		this.softAbortHandler = handler;
	}

	async executeAll(timeoutMs = 3000) {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;

		debugLogger.info("[CleanupManager] Starting cleanup sequence...");

		await this.drainStdin();

		const tasksToRun = [...this.tasks].reverse();
		this.tasks = [];

		for (const { name, task } of tasksToRun) {
			try {
				debugLogger.debug(`[CleanupManager] Executing task: ${name}`);
				await Promise.race([
					task(),
					new Promise((_, reject) =>
						setTimeout(
							() => reject(new Error(`Task "${name}" timed out`)),
							timeoutMs,
						),
					),
				]);
			} catch (error) {
				debugLogger.warn(
					`[CleanupManager] Task "${name}" failed or timed out:`,
					error,
				);
			}
		}

		debugLogger.info("[CleanupManager] Cleanup complete.");
	}

	private async drainStdin() {
		if (!process.stdin?.isTTY) return;
		try {
			// Stop reading from stdin
			process.stdin.pause();
			if (process.stdin.setRawMode) {
				process.stdin.setRawMode(false);
			}
		} catch (_err) {
			// Ignore
		}
	}

	async gracefulShutdown(reason: string, exitCode = ExitCodes.SUCCESS) {
		if (this.isShuttingDown) return;
		debugLogger.info(`[CleanupManager] Graceful shutdown initiated: ${reason}`);
		await this.executeAll();
		process.exit(exitCode);
	}

	handleCrash(error: unknown) {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;

		const errorMsg = error instanceof Error ? error.stack : String(error);
		const logMsg = `\n[${new Date().toISOString()}] CRASH DETECTED:\n${errorMsg}\n`;

		process.stderr.write(logMsg);

		try {
			appendFileSync("crash.log", logMsg, "utf-8");
		} catch {
			// Ignore
		}

		debugLogger.error("[CleanupManager] Emergency exit. Data loss may occur.");
		process.exit(1);
	}

	setupSignalHandlers() {
		process.on("SIGHUP", () => this.gracefulShutdown("SIGHUP"));
		process.on("SIGTERM", () => this.gracefulShutdown("SIGTERM"));
		process.on("SIGINT", () => {
			const now = Date.now();
			if (now - this.lastSigInt < 1000) {
				this.gracefulShutdown("SIGINT (double-tap)");
			} else {
				this.lastSigInt = now;
				debugLogger.info(
					"[CleanupManager] SIGINT received. Soft abort triggered. Press again within 1s to exit.",
				);
				if (this.softAbortHandler) {
					this.softAbortHandler();
				}
			}
		});

		process.on("uncaughtException", (error) => {
			this.handleCrash(error);
		});

		process.on("unhandledRejection", (reason) => {
			this.handleCrash(reason);
		});
	}

	async cleanupCheckpoints() {
		try {
			if (state.vaultPath) {
				const vectorCacheDir = path.join(
					state.vaultPath,
					".obsidian",
					"vector_cache",
				);
				if (existsSync(vectorCacheDir)) {
					const lockFile = path.join(vectorCacheDir, "write.lock");
					if (existsSync(lockFile)) {
						await fs.unlink(lockFile);
						debugLogger.debug("[CleanupManager] Stale VectorDB lock removed.");
					}
				}
			}

			const tempDir = path.join(APP_DATA_DIR, "temp");
			if (existsSync(tempDir)) {
				await fs.rm(tempDir, { recursive: true, force: true });
				debugLogger.debug("[CleanupManager] Temp directory cleaned up.");
			}
		} catch (error) {
			debugLogger.warn(
				"[CleanupManager] Failed to cleanup checkpoints:",
				error,
			);
		}
	}
}

export const cleanupManager = new CleanupManager();

export const registerCleanup = (name: string, task: CleanupTask) =>
	cleanupManager.register(name, task);
export const registerSoftAbort = (handler: () => void) =>
	cleanupManager.registerSoftAbort(handler);
export const runExitCleanup = () => cleanupManager.executeAll();
export const setupSignalHandlers = () => cleanupManager.setupSignalHandlers();
export const cleanupCheckpoints = () => cleanupManager.cleanupCheckpoints();
export const gracefulShutdown = (reason: string) =>
	cleanupManager.gracefulShutdown(reason);
