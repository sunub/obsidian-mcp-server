import { isAbortError, withTimeout } from "@shared/async/abort.js";
import { localEmbedder } from "./Embedder.js";

type LocalModelResource = {
	checkModelPresence: () => Promise<boolean>;
	init: () => Promise<void>;
	dispose: () => void | Promise<void>;
};

export interface LocalModelManagerOptions {
	embedder?: LocalModelResource;
	idleTtlMs?: number;
	hardTimeoutMs?: number;
}

type WarmState = "idle" | "warming" | "ready" | "degraded";

export class LocalModelManager {
	private readonly embedder: LocalModelResource;
	private readonly idleTtlMs: number;
	private readonly hardTimeoutMs: number;
	private embedderWarmup: Promise<boolean> | null = null;
	private embedderState: WarmState = "idle";
	private idleTimer: NodeJS.Timeout | null = null;
	private disposal: Promise<void> | null = null;
	private lateWarmupCleanupScheduled = false;
	private isShutdown = false;
	private activeUses = 0;

	constructor(options: LocalModelManagerOptions = {}) {
		this.embedder = options.embedder ?? localEmbedder;
		this.idleTtlMs = options.idleTtlMs ?? 30 * 1000;
		this.hardTimeoutMs = options.hardTimeoutMs ?? 10 * 1000;
	}

	get isEmbedderReady(): boolean {
		return this.embedderState === "ready";
	}

	async hasEmbedderFiles(): Promise<boolean> {
		return this.embedder.checkModelPresence();
	}

	async holdModels<T>(task: () => Promise<T>): Promise<T> {
		this.activeUses++;
		this.cancelIdleDispose();
		try {
			return await task();
		} finally {
			this.activeUses--;
			this.scheduleIdleDispose();
		}
	}

	async withEmbedder<T>(
		softDeadlineMs: number,
		fn: (ready: boolean) => Promise<T>,
	): Promise<T> {
		return this.holdModels(async () =>
			fn(await this.waitForEmbedder(softDeadlineMs)),
		);
	}

	beginToolCall(): void {
		if (this.isShutdown) {
			return;
		}
		this.activeUses++;
		this.cancelIdleDispose();
	}

	async endToolCall(): Promise<void> {
		if (this.activeUses > 0) {
			this.activeUses--;
		}
		if (this.activeUses === 0) {
			this.cancelIdleDispose();
			await this.disposeIdleModels();
		}
	}

	private disposeIdleModels(): Promise<void> {
		this.disposal ??= this.releaseModels().finally(() => {
			this.disposal = null;
		});
		return this.disposal;
	}

	private async releaseModels(): Promise<void> {
		if (this.isShutdown) {
			return;
		}
		const pendingWarmup = this.embedderWarmup;
		if (pendingWarmup) {
			this.scheduleLateWarmupCleanup(pendingWarmup);
		}

		await this.embedder.dispose();
		if (!pendingWarmup) {
			this.embedderWarmup = null;
		}
		this.embedderState = "idle";
	}

	async shutdown(): Promise<void> {
		this.isShutdown = true;
		this.cancelIdleDispose();
		await this.embedder.dispose();
		this.embedderWarmup = null;
		this.embedderState = "idle";
	}

	private async waitForEmbedder(softDeadlineMs: number): Promise<boolean> {
		await this.disposal;
		if (this.isShutdown) {
			return false;
		}

		this.embedderWarmup ??= this.warmEmbedder();
		try {
			return await withTimeout(this.embedderWarmup, softDeadlineMs);
		} catch {
			return false;
		}
	}

	private async warmEmbedder(): Promise<boolean> {
		this.embedderState = "warming";

		try {
			if (!(await this.embedder.checkModelPresence())) {
				this.embedderState = "degraded";
				return false;
			}

			await withTimeout(
				this.embedder.init(),
				this.hardTimeoutMs,
				`embedder warmup exceeded ${this.hardTimeoutMs}ms`,
			);
			this.embedderState = "ready";
			return true;
		} catch (error) {
			if (!isAbortError(error)) {
				this.embedderState = "degraded";
			}
			return false;
		} finally {
			this.embedderWarmup = null;
		}
	}

	private cancelIdleDispose(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}

	private scheduleLateWarmupCleanup(pendingWarmup: Promise<boolean>): void {
		if (this.lateWarmupCleanupScheduled) {
			return;
		}

		this.lateWarmupCleanupScheduled = true;
		void Promise.allSettled([pendingWarmup])
			.then(async () => {
				this.lateWarmupCleanupScheduled = false;
				if (this.activeUses === 0 && !this.isShutdown) {
					await this.disposeIdleModels();
				}
			})
			.catch(() => {
				this.lateWarmupCleanupScheduled = false;
			});
	}

	private scheduleIdleDispose(): void {
		this.cancelIdleDispose();
		if (this.activeUses === 0) {
			this.idleTimer = setTimeout(() => {
				void this.disposeIdleModels();
			}, this.idleTtlMs);
		}
	}
}

export const localModelManager = new LocalModelManager();
