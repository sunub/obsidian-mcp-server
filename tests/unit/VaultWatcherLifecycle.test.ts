import { describe, expect, test, vi } from "vitest";

const watcherClose = vi.hoisted(() => vi.fn(async () => undefined));
const watcherOn = vi.hoisted(() => vi.fn(() => fakeWatcher));
const fakeWatcher = vi.hoisted(() => ({
	on: watcherOn,
	close: watcherClose,
}));
const initialize = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("chokidar", () => ({
	default: {
		watch: vi.fn(() => fakeWatcher),
	},
}));

vi.mock("../../src/utils/getVaultManager.js", () => ({
	getGlobalVaultManager: () => ({
		initialize,
		upsertDocument: vi.fn(async () => undefined),
		removeDocument: vi.fn(async () => undefined),
		shutdown: vi.fn(async () => undefined),
	}),
}));

describe("VaultWatcher lifecycle", () => {
	test("does not build the full vault index when the server starts", async () => {
		const { VaultWatcher } = await import("../../src/utils/VaultWatcher.js");
		const watcher = new VaultWatcher();

		await watcher.start("/tmp/test-vault");
		await watcher.stop();

		expect(initialize).not.toHaveBeenCalled();
	});
});
