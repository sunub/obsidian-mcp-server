const syncCleanupFunctions: Array<() => void> = [];

export function registerSyncCleanup(fn: () => void) {
	syncCleanupFunctions.push(fn);
}
