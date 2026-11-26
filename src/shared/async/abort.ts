const ABORT_ERROR_NAME = "AbortError";

export function createAbortError(message = "Operation aborted"): Error {
	const error = new Error(message);
	error.name = ABORT_ERROR_NAME;
	return error;
}

export function isAbortError(error: unknown): boolean {
	if (error instanceof Error) {
		return error.name === ABORT_ERROR_NAME;
	}
	return error instanceof DOMException && error.name === ABORT_ERROR_NAME;
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) {
		return;
	}
	throw signal.reason ?? createAbortError();
}

export function waitForAbortable(
	ms: number,
	signal?: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);

		const onAbort = () => {
			cleanup();
			reject(signal?.reason ?? createAbortError());
		};

		const cleanup = () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
		};

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message = `Timed out after ${ms}ms`,
): Promise<T> {
	let timeout: NodeJS.Timeout | null = null;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeout = setTimeout(() => reject(new Error(message)), ms);
	});

	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}
