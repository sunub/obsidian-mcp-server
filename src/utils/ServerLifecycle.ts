import { BackgroundTaskRegistry } from "./BackgroundTaskRegistry.js";
import { localModelManager } from "./LocalModelManager.js";
import { createAbortError, withTimeout } from "./abort.js";

type CleanupTask = () => Promise<void> | void;
type ToolCallModelManager = {
	beginToolCall: () => void;
	endToolCall: () => Promise<void>;
};

interface RegisteredCleanup {
	name: string;
	task: CleanupTask;
}

export interface ServerLifecycleOptions {
	modelManager?: ToolCallModelManager;
}

export class ServerLifecycle {
	private readonly controller = new AbortController();
	private readonly backgroundTasks = new BackgroundTaskRegistry();
	private readonly modelManager: ToolCallModelManager;
	private readonly cleanups: RegisteredCleanup[] = [];
	private shutdownPromise: Promise<void> | null = null;

	constructor(options: ServerLifecycleOptions = {}) {
		this.modelManager = options.modelManager ?? localModelManager;
	}

	get signal(): AbortSignal {
		return this.controller.signal;
	}

	registerCleanup(name: string, task: CleanupTask): void {
		this.cleanups.push({ name, task });
	}

	runBackgroundTask<T>(
		name: string,
		task: (signal: AbortSignal) => Promise<T>,
	): Promise<T | undefined> {
		return this.backgroundTasks.run(name, task);
	}

	async runToolCall<T>(name: string, task: () => Promise<T>): Promise<T> {
		this.modelManager.beginToolCall();
		try {
			return await task();
		} finally {
			await this.modelManager.endToolCall();
		}
	}

	shutdown(reason: string, timeoutMs = 3000): Promise<void> {
		if (this.shutdownPromise) {
			return this.shutdownPromise;
		}

		this.shutdownPromise = this.executeShutdown(reason, timeoutMs);
		return this.shutdownPromise;
	}

	private async executeShutdown(
		reason: string,
		timeoutMs: number,
	): Promise<void> {
		if (!this.controller.signal.aborted) {
			this.controller.abort(createAbortError(reason));
		}

		await this.backgroundTasks.abortAll(reason, timeoutMs);

		const cleanups = [...this.cleanups].reverse();
		this.cleanups.length = 0;
		for (const { task } of cleanups) {
			await withTimeout(Promise.resolve(task()), timeoutMs).catch(
				() => undefined,
			);
		}
	}
}
