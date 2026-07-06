import { describe, expect, test, vi } from "vitest";
import { LocalModelManager } from "../../src/utils/LocalModelManager";

const mocks = vi.hoisted(() => ({
	pipeline: vi.fn(),
	tokenizer: vi.fn(),
	sequenceModel: vi.fn(),
}));

vi.mock("@huggingface/transformers", () => ({
	env: {},
	pipeline: mocks.pipeline,
	AutoTokenizer: {
		from_pretrained: mocks.tokenizer,
	},
	AutoModelForSequenceClassification: {
		from_pretrained: mocks.sequenceModel,
	},
}));

describe("local model presence checks", () => {
	test("embedder checkModelPresence does not initialize transformer pipeline", async () => {
		const { localEmbedder } = await import("../../src/utils/Embedder");

		await localEmbedder.checkModelPresence();

		expect(mocks.pipeline).not.toHaveBeenCalled();
		expect(mocks.tokenizer).not.toHaveBeenCalled();
	});

	test("reranker checkModelPresence does not initialize transformer model", async () => {
		const { localReranker } = await import("../../src/utils/LocalReranker");

		await localReranker.checkModelPresence();

		expect(mocks.tokenizer).not.toHaveBeenCalled();
		expect(mocks.sequenceModel).not.toHaveBeenCalled();
	});
});

describe("LocalModelManager", () => {
	test("withEmbedder returns false when warmup misses the soft deadline", async () => {
		vi.useFakeTimers();
		const init = vi.fn(
			() => new Promise<void>((resolve) => setTimeout(resolve, 100)),
		);
		const manager = new LocalModelManager({
			embedder: {
				checkModelPresence: async () => true,
				init,
				dispose: vi.fn(),
			},
			reranker: {
				checkModelPresence: async () => false,
				init: vi.fn(),
				dispose: vi.fn(),
			},
			idleTtlMs: 1000,
			hardTimeoutMs: 1000,
		});

		const resultPromise = manager.withEmbedder(10, async (ready) => ready);
		await vi.advanceTimersByTimeAsync(10);

		await expect(resultPromise).resolves.toBe(false);
		expect(init).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(100);
		await manager.shutdown();
		vi.useRealTimers();
	});

	test("withReranker shares concurrent warmup", async () => {
		const init = vi.fn(async () => undefined);
		const manager = new LocalModelManager({
			embedder: {
				checkModelPresence: async () => false,
				init: vi.fn(),
				dispose: vi.fn(),
			},
			reranker: {
				checkModelPresence: async () => true,
				init,
				dispose: vi.fn(),
			},
		});

		const [first, second] = await Promise.all([
			manager.withReranker(100, async (ready) => ready),
			manager.withReranker(100, async (ready) => ready),
		]);

		expect(first).toBe(true);
		expect(second).toBe(true);
		expect(init).toHaveBeenCalledTimes(1);
	});

	test("endToolCall disposes warmed models when the tool call finishes", async () => {
		const embedderDispose = vi.fn();
		const rerankerDispose = vi.fn();
		const manager = new LocalModelManager({
			embedder: {
				checkModelPresence: async () => true,
				init: vi.fn(async () => undefined),
				dispose: embedderDispose,
			},
			reranker: {
				checkModelPresence: async () => true,
				init: vi.fn(async () => undefined),
				dispose: rerankerDispose,
			},
			idleTtlMs: 1000,
		});

		manager.beginToolCall();
		await manager.withEmbedder(100, async (ready) => {
			expect(ready).toBe(true);
		});
		await manager.withReranker(100, async (ready) => {
			expect(ready).toBe(true);
		});

		expect(embedderDispose).not.toHaveBeenCalled();
		expect(rerankerDispose).not.toHaveBeenCalled();

		await manager.endToolCall();

		expect(embedderDispose).toHaveBeenCalledTimes(1);
		expect(rerankerDispose).toHaveBeenCalledTimes(1);
	});

	test("endToolCall keeps models alive until the last concurrent tool call ends", async () => {
		const dispose = vi.fn();
		const manager = new LocalModelManager({
			embedder: {
				checkModelPresence: async () => true,
				init: vi.fn(async () => undefined),
				dispose,
			},
			reranker: {
				checkModelPresence: async () => false,
				init: vi.fn(),
				dispose: vi.fn(),
			},
		});

		manager.beginToolCall();
		manager.beginToolCall();
		await manager.withEmbedder(100, async (ready) => {
			expect(ready).toBe(true);
		});

		await manager.endToolCall();
		expect(dispose).not.toHaveBeenCalled();

		await manager.endToolCall();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	test("endToolCall disposes again after a late warmup finishes", async () => {
		vi.useFakeTimers();
		const embedderDispose = vi.fn();
		const manager = new LocalModelManager({
			embedder: {
				checkModelPresence: async () => true,
				init: vi.fn(
					() => new Promise<void>((resolve) => setTimeout(resolve, 100)),
				),
				dispose: embedderDispose,
			},
			reranker: {
				checkModelPresence: async () => false,
				init: vi.fn(),
				dispose: vi.fn(),
			},
			hardTimeoutMs: 1000,
		});

		manager.beginToolCall();
		const resultPromise = manager.withEmbedder(10, async (ready) => ready);
		await vi.advanceTimersByTimeAsync(10);
		await expect(resultPromise).resolves.toBe(false);

		await manager.endToolCall();
		expect(embedderDispose).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(100);
		await vi.runAllTimersAsync();

		expect(embedderDispose).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});
});
