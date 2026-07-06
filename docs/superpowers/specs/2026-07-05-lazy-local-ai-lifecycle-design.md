# Lazy Local AI Lifecycle Design

## Context

The current MCP server eagerly loads local embedding and reranking models during
startup. Each agent session can spawn its own MCP server process, so each process
can hold a separate copy of the local model stack. Agent shutdown also does not
reliably stop background RAG indexing, worker threads, or model resources.

The desired behavior is a lightweight MCP server that starts quickly, only warms
local AI resources when semantic search actually needs them, and guarantees best
effort cleanup when the agent disconnects or exits.

## Current Problems

Startup performs model work. `src/index.ts` calls `localEmbedder.checkModelPresence()`
and `localReranker.checkModelPresence()`, but those methods call `init()`. A
presence check therefore loads models into memory.

Background indexing is not owned by shutdown. `VaultWatcher.start()` launches
`vaultManager.syncMissingRagIndices()` as a fire-and-forget promise. The promise is
not tracked, and no `AbortSignal` is passed through the indexing pipeline.

Shutdown only closes the file watcher. The MCP server cleanup path calls
`vaultWatcher.stop()`, which closes chokidar but does not stop RAG sync, worker
threads, local model references, vector DB work, or pending semaphore waiters.

Transport disconnect is not a shutdown trigger. The server listens for `SIGINT`
and `SIGTERM`, but stdio MCP clients can disappear through stdin EOF, transport
close, parent process exit, or `SIGHUP`.

Worker pools are not tied to server lifecycle. `RAGIndexer.indexAll()` terminates
workers in a local `finally`, but the server-wide cleanup path does not call a
RAG indexer shutdown method. Pending worker promises also are not rejected when
workers are terminated.

## Goals

- Keep MCP startup lightweight and memory efficient.
- Do not load embedder or reranker during server startup.
- Preserve high quality semantic search when local models are available.
- Bound tool-call latency so agents do not stall indefinitely.
- Stop background work when the MCP client disconnects or the process exits.
- Make shutdown idempotent and safe to call from multiple signals.
- Avoid new dependencies.

## Non-Goals

- Do not introduce a shared daemon in the first implementation.
- Do not replace the existing embedding or reranking models.
- Do not redesign the vector database schema unless required for lifecycle safety.
- Do not make every search wait for semantic warmup by default.

## Proposed Behavior

Server startup should initialize only the lightweight path:

- parse configuration
- register MCP tools
- build or load keyword index
- start the vault watcher
- inspect local model cache through file-level presence checks only

Semantic model loading should begin only when a semantic or hybrid search path
needs it. The default tool call should use a 3 second soft deadline:

- If semantic resources are ready within 3 seconds, return hybrid or reranked
  semantic results.
- If semantic resources are not ready within 3 seconds, return keyword results
  with a diagnostic message that local semantic search is warming.
- Continue warmup in the background after the fallback response.

The warmup attempt should have a 10 second hard cap. If warmup exceeds that cap,
the manager records a degraded state and later calls may retry.

The reranker should load separately from the embedder. It should warm only when
vector results are ambiguous enough to require reranking. If vector results are
already highly relevant, reranking should be skipped.

Local AI resources should remain warm briefly after use. The initial idle TTL
should be 5 minutes after the last semantic or rerank use. After the TTL expires,
the model manager should dispose resources where the underlying library supports
disposal, clear references, clear timers, and allow garbage collection.

## Architecture

### Server Lifecycle

Add a server lifecycle owner responsible for shutdown coordination. It should own
a root `AbortController`, expose the root `AbortSignal`, and provide an
idempotent `shutdown(reason)` method.

All process and transport termination paths should call the same shutdown method:

- `SIGINT`
- `SIGTERM`
- `SIGHUP`
- stdio transport close
- stdin `end`, `close`, and `error`
- fatal startup failure paths where cleanup is possible

Shutdown order:

1. Mark shutdown as started.
2. Abort the root controller.
3. Stop accepting watcher events.
4. Stop or await tracked background tasks with a short timeout.
5. Shutdown RAG indexer and worker pool.
6. Dispose local model manager resources.
7. Close server/transport resources where applicable.
8. Exit only after cleanup finishes or times out.

### Background Task Registry

Fire-and-forget work should be registered. The registry tracks promises and gives
shutdown a bounded way to wait for them.

Background task rules:

- every task gets an `AbortSignal`
- every task is removed from the registry when settled
- shutdown aborts all tasks
- shutdown waits for tasks up to a fixed timeout
- timeout is logged but does not block process exit forever

### Local Model Manager

Introduce a manager around embedder and reranker initialization. It should provide:

- cache-only model presence checks
- shared in-flight warmup promise
- 3 second soft deadline helper for default tool calls
- 10 second hard cap for warm attempts
- separate embedder and reranker states
- idle TTL cleanup
- explicit `shutdown()` method

The existing `checkModelPresence()` methods should stop calling `init()`. Either
rename them to clarify behavior or split them into:

- `hasLocalModelFiles()`
- `ensureReady()`

### RAG Indexer

RAG indexing should accept an `AbortSignal` through the full pipeline:

- `syncMissingRagIndices(signal)`
- `executeSync(signal)`
- `ragIndexer.processFile(filePath, { signal })`
- worker pool task submission

Long loops should call `signal.throwIfAborted()` between files, before expensive
model calls, and after worker results return.

The indexer should add `shutdown()` to:

- stop spinner output
- mark indexing false
- terminate worker pool
- reject queued worker tasks
- release or avoid stranded semaphore waiters where possible

### Worker Pool

Worker tasks should be cancellable at task boundaries. `terminateAll()` should
await worker termination and reject queued or active task promises with an abort
error. If a task receives an abort signal while queued, it should be removed and
rejected. If it is active, the worker can be terminated or allowed to finish
depending on the operation's safety.

## Tool Call Policy

Default search policy:

- run keyword retrieval immediately
- start semantic warmup if hybrid search is requested and models are present
- wait up to 3 seconds for semantic readiness
- return hybrid results if ready
- otherwise return keyword fallback with diagnostic text

Quality-first optional policy:

- a later explicit option may allow waiting up to 10 seconds
- this should not be the default because agent tool loops should stay responsive

Rerank policy:

- skip reranking when top vector distance is already strong
- lazy-load reranker only for ambiguous candidate sets
- if reranker warmup misses the default deadline, return fused results rather
  than blocking indefinitely

## Error Handling

Abort should be treated as normal shutdown, not as an error. Logs should distinguish:

- expected abort during shutdown
- semantic warmup timeout
- missing local model files
- model load failure
- indexing failure unrelated to shutdown

When semantic search falls back to keyword search, the tool response should include
a diagnostic message so the agent can decide whether to retry.

## Testing Strategy

Unit tests:

- model presence checks do not initialize model pipelines
- model manager shares concurrent warmup promises
- 3 second soft deadline returns fallback when warmup is slow
- 10 second hard cap records degraded state
- idle TTL calls disposal/cleanup
- shutdown aborts registered background tasks
- worker pool rejects queued tasks on shutdown

Integration tests:

- MCP server startup does not call embedder or reranker `init()`
- hybrid search falls back to keyword when semantic warmup exceeds the soft
  deadline
- second hybrid search can use warmed semantic resources
- server cleanup handles `SIGTERM`
- server cleanup handles transport/stdin close

Manual verification:

- start multiple agent sessions and confirm startup memory stays low
- trigger semantic search and confirm memory increases only after the call
- wait past idle TTL and confirm resources are released as much as the runtime
  allows
- terminate the agent and confirm no lingering indexing workers remain

## Acceptance Criteria

- Starting the MCP server does not load embedder or reranker models.
- Local model presence checks complete without model initialization.
- Default semantic search never waits more than 3 seconds before returning a
  fallback response.
- Warmup attempts are capped at 10 seconds.
- Reranker loads only when reranking is actually needed.
- Background RAG sync is tracked and abortable.
- Server shutdown runs from signals, transport close, and stdin close paths.
- Worker threads are terminated during shutdown.
- Idle local AI resources are cleaned up after 5 minutes without semantic use.

## Open Implementation Notes

The first implementation should prioritize lifecycle safety and startup memory
reduction over perfect model memory reclamation. Some transformer or ONNX runtime
objects may not expose deterministic disposal. In that case, cleanup should clear
references, stop timers, terminate workers, and rely on process exit or garbage
collection for remaining native memory.
