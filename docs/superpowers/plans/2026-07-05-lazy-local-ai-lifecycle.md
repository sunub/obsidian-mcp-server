# Lazy Local AI Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MCP server start without loading local AI models, warm semantic search lazily with bounded fallback, and stop background work on agent disconnect.

**Architecture:** Add small lifecycle primitives first: abort helpers, a background task registry, and cancellable worker/indexer shutdown. Then split model presence checks from model initialization and route semantic search through bounded lazy warmup. Finally wire server shutdown to signals, stdin, and stdio transport close.

**Tech Stack:** TypeScript, Node.js `AbortController`, Vitest, MCP stdio transport, `@huggingface/transformers`, worker threads.

---

### Task 1: Abortable Infrastructure

**Files:**
- Create: `src/utils/abort.ts`
- Create: `src/utils/BackgroundTaskRegistry.ts`
- Test: `tests/unit/BackgroundTaskRegistry.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, test, vi } from "vitest";
import { BackgroundTaskRegistry } from "../../src/utils/BackgroundTaskRegistry";
import { isAbortError, waitForAbortable } from "../../src/utils/abort";

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

		await registry.abortAll("shutdown", 100);
		await vi.runAllTimersAsync();

		expect(events).toEqual([]);
		expect(registry.size).toBe(0);
		vi.useRealTimers();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/BackgroundTaskRegistry.test.ts`

Expected: fail because the new files do not exist.

- [ ] **Step 3: Implement abort helpers and task registry**

Create `src/utils/abort.ts` with `createAbortError`, `isAbortError`, `throwIfAborted`, `waitForAbortable`, and `withTimeout`.

Create `src/utils/BackgroundTaskRegistry.ts` with a registry that owns one `AbortController` per task, removes tasks when settled, aborts all tasks during shutdown, and waits with a timeout.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/BackgroundTaskRegistry.test.ts`

Expected: pass.

### Task 2: Model Presence Without Startup Load

**Files:**
- Modify: `src/utils/Embedder.ts`
- Modify: `src/utils/LocalReranker.ts`
- Create: `src/utils/LocalModelManager.ts`
- Test: `tests/unit/LocalModelLifecycle.test.ts`

- [ ] **Step 1: Write failing tests**

Test that `checkModelPresence()` does not call `init()`, and that `LocalModelManager` returns a fallback result when warmup misses the soft deadline.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/LocalModelLifecycle.test.ts`

Expected: fail because presence checks still load models and manager does not exist.

- [ ] **Step 3: Implement model lifecycle**

Change `checkModelPresence()` to inspect `MODELS_DIR/<modelName>` only. Add `hasLocalModelFiles()` and keep `init()` as the only model-loading path. Add best-effort `dispose()` methods that clear references and init promises.

Create `LocalModelManager` with shared in-flight warmup, 3 second soft deadline, 10 second hard cap, separate embedder/reranker readiness, 5 minute idle cleanup, and `shutdown()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/LocalModelLifecycle.test.ts`

Expected: pass.

### Task 3: Cancellable RAG and Worker Shutdown

**Files:**
- Modify: `src/utils/worker/WorkerPool.ts`
- Modify: `src/utils/RAGIndexer.ts`
- Modify: `src/utils/VaultManger/VaultManager.ts`
- Test: `tests/unit/WorkerPoolLifecycle.test.ts`

- [ ] **Step 1: Write failing tests**

Test that queued worker tasks are rejected on `terminateAll()` and that `VaultManager.syncMissingRagIndices(signal)` stops when aborted.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/WorkerPoolLifecycle.test.ts`

Expected: fail because shutdown is not async/cancellable yet.

- [ ] **Step 3: Implement cancellation through RAG**

Add signal arguments to RAG sync and indexing methods. Check `throwIfAborted()` between files and expensive work. Add `ragIndexer.shutdown()` and make worker pool termination reject pending tasks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/WorkerPoolLifecycle.test.ts`

Expected: pass.

### Task 4: Server Shutdown Wiring

**Files:**
- Create: `src/utils/ServerLifecycle.ts`
- Modify: `src/utils/VaultWatcher.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/ServerLifecycle.test.ts`

- [ ] **Step 1: Write failing tests**

Test idempotent shutdown, background task abort, and watcher stop integration.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/ServerLifecycle.test.ts`

Expected: fail because lifecycle owner does not exist.

- [ ] **Step 3: Implement server lifecycle wiring**

Create `ServerLifecycle`, pass its signal/task registry into `VaultWatcher.start()`, wire shutdown to `SIGINT`, `SIGTERM`, `SIGHUP`, transport close, and stdin close/error/end.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/ServerLifecycle.test.ts`

Expected: pass.

### Task 5: Semantic Search Fallback Integration

**Files:**
- Modify: `src/utils/VaultManger/VaultManager.ts`
- Modify: `src/tools/vault/utils/actions/read.ts`
- Modify: `src/tools/vault/utils/actions/collect_context.ts`
- Test: `tests/unit/VaultSemanticFallback.test.ts`

- [ ] **Step 1: Write failing tests**

Test that startup availability checks do not load models, default hybrid search returns keyword fallback when semantic warmup misses the soft deadline, and warm search uses semantic path once ready.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/VaultSemanticFallback.test.ts`

Expected: fail until `VaultManager` uses `LocalModelManager`.

- [ ] **Step 3: Implement bounded semantic fallback**

Route hybrid search through `localModelManager.waitForEmbedder(3000)`. Return keyword fallback and diagnostic when timeout occurs. Use reranker only through `localModelManager.waitForReranker()` after vector results show reranking is needed.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
npm test -- tests/unit/BackgroundTaskRegistry.test.ts tests/unit/LocalModelLifecycle.test.ts tests/unit/WorkerPoolLifecycle.test.ts tests/unit/ServerLifecycle.test.ts tests/unit/VaultSemanticFallback.test.ts
npm run build
```

Expected: tests and build pass.
