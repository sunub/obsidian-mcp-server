import { isAbortError, withTimeout } from "./abort.js";
import { localEmbedder } from "./Embedder.js";
import { localReranker } from "./LocalReranker.js";

type LocalModelResource = {
	checkModelPresence: () => Promise<boolean>;
	init: () => Promise<void>;
	dispose: () => void | Promise<void>;
};

export interface LocalModelManagerOptions {
	embedder?: LocalModelResource;
	reranker?: LocalModelResource;
	idleTtlMs?: number;
	hardTimeoutMs?: number;
}

type WarmState = "idle" | "warming" | "ready" | "degraded";

export class LocalModelManager {
	private readonly embedder: LocalModelResource;
	private readonly reranker: LocalModelResource;
	private readonly idleTtlMs: number;
	private readonly hardTimeoutMs: number;
	private embedderWarmup: Promise<boolean> | null = null;
	private rerankerWarmup: Promise<boolean> | null = null;
	private embedderState: WarmState = "idle";
	private rerankerState: WarmState = "idle";
	private idleTimer: NodeJS.Timeout | null = null;
	private lateWarmupCleanupScheduled = false;
	private isShutdown = false;
	private activeUses = 0;

	constructor(options: LocalModelManagerOptions = {}) {
		this.embedder = options.embedder ?? localEmbedder;
		this.reranker = options.reranker ?? localReranker;
		this.idleTtlMs = options.idleTtlMs ?? 30 * 1000;
		this.hardTimeoutMs = options.hardTimeoutMs ?? 10 * 1000;
	}

	get isEmbedderReady(): boolean {
		return this.embedderState === "ready";
	}

	get isRerankerReady(): boolean {
		return this.rerankerState === "ready";
	}

	async hasEmbedderFiles(): Promise<boolean> {
		return this.embedder.checkModelPresence();
	}

	async hasRerankerFiles(): Promise<boolean> {
		return this.reranker.checkModelPresence();
	}

	async withEmbedder<T>(
		softDeadlineMs: number,
		fn: (ready: boolean) => Promise<T>,
	): Promise<T> {
		this.activeUses++;
		this.cancelIdleDispose();
		try {
			const ready = await this.waitFor("embedder", softDeadlineMs);
			return await fn(ready);
		} finally {
			this.activeUses--;
			this.scheduleIdleDispose();
		}
	}

	async withReranker<T>(
		softDeadlineMs: number,
		fn: (ready: boolean) => Promise<T>,
	): Promise<T> {
		this.activeUses++;
		this.cancelIdleDispose();
		try {
			const ready = await this.waitFor("reranker", softDeadlineMs);
			return await fn(ready);
		} finally {
			this.activeUses--;
			this.scheduleIdleDispose();
		}
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

	private async disposeIdleModels(): Promise<void> {
		if (this.isShutdown) {
			return;
		}
		const pendingWarmups = [this.embedderWarmup, this.rerankerWarmup].filter(
			(warmup): warmup is Promise<boolean> => warmup !== null,
		);
		const embedderHasPendingWarmup = this.embedderWarmup !== null;
		const rerankerHasPendingWarmup = this.rerankerWarmup !== null;
		this.scheduleLateWarmupCleanup(pendingWarmups);

		await this.embedder.dispose();
		await this.reranker.dispose();
		if (!embedderHasPendingWarmup) {
			this.embedderWarmup = null;
		}
		if (!rerankerHasPendingWarmup) {
			this.rerankerWarmup = null;
		}
		this.embedderState = "idle";
		this.rerankerState = "idle";
	}

	async shutdown(): Promise<void> {
		this.isShutdown = true;
		this.cancelIdleDispose();
		await this.embedder.dispose();
		await this.reranker.dispose();
		this.embedderWarmup = null;
		this.rerankerWarmup = null;
		this.embedderState = "idle";
		this.rerankerState = "idle";
	}

	private async waitFor(
		resource: "embedder" | "reranker",
		softDeadlineMs: number,
	): Promise<boolean> {
		if (this.isShutdown) {
			return false;
		}

		const warmup = this.ensureWarmup(resource);
		try {
			const ready = await withTimeout(warmup, softDeadlineMs);
			return ready;
		} catch {
			return false;
		}
	}

	private ensureWarmup(resource: "embedder" | "reranker"): Promise<boolean> {
		if (resource === "embedder") {
			if (!this.embedderWarmup) {
				this.embedderWarmup = this.warmResource("embedder");
			}
			return this.embedderWarmup;
		}

		if (!this.rerankerWarmup) {
			this.rerankerWarmup = this.warmResource("reranker");
		}
		return this.rerankerWarmup;
	}

	private async warmResource(
		resource: "embedder" | "reranker",
	): Promise<boolean> {
		const target = resource === "embedder" ? this.embedder : this.reranker;
		this.setState(resource, "warming");

		try {
			if (!(await target.checkModelPresence())) {
				this.setState(resource, "degraded");
				return false;
			}

			await withTimeout(
				target.init(),
				this.hardTimeoutMs,
				`${resource} warmup exceeded ${this.hardTimeoutMs}ms`,
			);
			this.setState(resource, "ready");
			return true;
		} catch (error) {
			if (!isAbortError(error)) {
				this.setState(resource, "degraded");
			}
			return false;
		} finally {
			if (resource === "embedder") {
				this.embedderWarmup = null;
			} else {
				this.rerankerWarmup = null;
			}
		}
	}

	private setState(resource: "embedder" | "reranker", state: WarmState): void {
		if (resource === "embedder") {
			this.embedderState = state;
		} else {
			this.rerankerState = state;
		}
	}

	private cancelIdleDispose(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}

	private scheduleLateWarmupCleanup(pendingWarmups: Promise<boolean>[]): void {
		if (pendingWarmups.length === 0 || this.lateWarmupCleanupScheduled) {
			return;
		}

		this.lateWarmupCleanupScheduled = true;
		void Promise.allSettled(pendingWarmups)
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
