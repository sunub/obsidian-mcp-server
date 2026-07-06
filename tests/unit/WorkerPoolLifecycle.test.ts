import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";
import { WorkerPool } from "../../src/utils/worker/WorkerPool";

class FakeWorker extends EventEmitter {
	terminated = false;
	postedMessages: unknown[] = [];

	postMessage(data: unknown) {
		this.postedMessages.push(data);
	}

	async terminate(): Promise<number> {
		this.terminated = true;
		this.emit("exit", 0);
		return 0;
	}
}

describe("WorkerPool lifecycle", () => {
	test("terminateAll rejects queued and active tasks", async () => {
		const workers: FakeWorker[] = [];
		const pool = new WorkerPool(1, () => {
			const worker = new FakeWorker();
			workers.push(worker);
			return worker;
		});

		const active = pool.runTask({
			filePath: "active.md",
			fileContent: "active",
			birthTime: new Date(0).toISOString(),
		});
		const queued = pool.runTask({
			filePath: "queued.md",
			fileContent: "queued",
			birthTime: new Date(0).toISOString(),
		});

		await pool.terminateAll();

		await expect(active).rejects.toThrow("Worker pool terminated");
		await expect(queued).rejects.toThrow("Worker pool terminated");
		expect(workers[0]?.terminated).toBe(true);
	});
});
