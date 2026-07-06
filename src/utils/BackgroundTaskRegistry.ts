import { createAbortError, isAbortError, withTimeout } from "./abort.js";

type BackgroundTask = {
	controller: AbortController;
	promise: Promise<void>;
};

export class BackgroundTaskRegistry {
	private tasks = new Map<string, BackgroundTask>();
	private nextId = 0;

	get size(): number {
		return this.tasks.size;
	}

	run<T>(
		name: string,
		task: (signal: AbortSignal) => Promise<T>,
	): Promise<T | undefined> {
		const id = `${name}:${this.nextId++}`;
		const controller = new AbortController();

		const promise = task(controller.signal)
			.catch((error: unknown) => {
				if (!isAbortError(error)) {
					throw error;
				}
				return undefined;
			})
			.finally(() => {
				this.tasks.delete(id);
			});

		this.tasks.set(id, {
			controller,
			promise: promise.then(() => undefined),
		});

		return promise;
	}

	async abortAll(reason: string, timeoutMs: number): Promise<void> {
		if (this.tasks.size === 0) {
			return;
		}

		const abortError = createAbortError(reason);
		const tasks = Array.from(this.tasks.values());
		for (const task of tasks) {
			task.controller.abort(abortError);
		}

		await withTimeout(
			Promise.allSettled(tasks.map((task) => task.promise)).then(
				() => undefined,
			),
			timeoutMs,
			`Background tasks did not stop within ${timeoutMs}ms`,
		).catch(() => undefined);
	}
}
