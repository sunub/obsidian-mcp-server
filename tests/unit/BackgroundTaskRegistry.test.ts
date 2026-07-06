import { describe, expect, test, vi } from "vitest";
import { isAbortError, waitForAbortable } from "../../src/utils/abort";
import { BackgroundTaskRegistry } from "../../src/utils/BackgroundTaskRegistry";

describe("abort helpers", () => {
	test("waitForAbortable rejects when aborted", async () => {
		const controller = new AbortController();
		const promise = waitForAbortable(1000, controller.signal);

		controller.abort(new Error("stop"));

		await expect(promise).rejects.toThrow("stop");
	});

	test("isAbortError recognizes aborted signals", () => {
		const controller = new AbortController();
		controller.abort();

		expect(isAbortError(controller.signal.reason)).toBe(true);
	});
});

describe("BackgroundTaskRegistry", () => {
	test("abortAll aborts registered tasks and waits for settlement", async () => {
		vi.useFakeTimers();
		const registry = new BackgroundTaskRegistry();
		const events: string[] = [];

		registry.run("slow", async (signal) => {
			await waitForAbortable(1000, signal);
			events.push("finished");
		});

		const abortPromise = registry.abortAll("shutdown", 100);
		await vi.runAllTimersAsync();
		await abortPromise;

		expect(events).toEqual([]);
		expect(registry.size).toBe(0);
		vi.useRealTimers();
	});

	test("settled tasks are removed from the registry", async () => {
		const registry = new BackgroundTaskRegistry();

		await registry.run("quick", async () => "done");

		expect(registry.size).toBe(0);
	});
});
