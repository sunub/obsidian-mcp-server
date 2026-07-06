import { describe, expect, test, vi } from "vitest";
import { waitForAbortable } from "../../src/utils/abort";
import { ServerLifecycle } from "../../src/utils/ServerLifecycle";

describe("ServerLifecycle", () => {
	test("shutdown is idempotent and runs cleanup once", async () => {
		const cleanup = vi.fn(async () => undefined);
		const lifecycle = new ServerLifecycle();
		lifecycle.registerCleanup("test", cleanup);

		await Promise.all([
			lifecycle.shutdown("first"),
			lifecycle.shutdown("second"),
		]);

		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(lifecycle.signal.aborted).toBe(true);
	});

	test("shutdown aborts tracked background tasks", async () => {
		const lifecycle = new ServerLifecycle();
		const events: string[] = [];

		lifecycle.runBackgroundTask("slow", async (signal) => {
			await waitForAbortable(1000, signal);
			events.push("finished");
		});

		await lifecycle.shutdown("stop");

		expect(events).toEqual([]);
	});

	test("runToolCall begins and ends local model tool scope", async () => {
		const modelManager = {
			beginToolCall: vi.fn(),
			endToolCall: vi.fn(async () => undefined),
		};
		const lifecycle = new ServerLifecycle({ modelManager });

		const result = await lifecycle.runToolCall("vault", async () => "ok");

		expect(result).toBe("ok");
		expect(modelManager.beginToolCall).toHaveBeenCalledTimes(1);
		expect(modelManager.endToolCall).toHaveBeenCalledTimes(1);
	});

	test("runToolCall ends local model scope when the tool throws", async () => {
		const modelManager = {
			beginToolCall: vi.fn(),
			endToolCall: vi.fn(async () => undefined),
		};
		const lifecycle = new ServerLifecycle({ modelManager });

		await expect(
			lifecycle.runToolCall("vault", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		expect(modelManager.beginToolCall).toHaveBeenCalledTimes(1);
		expect(modelManager.endToolCall).toHaveBeenCalledTimes(1);
	});
});
