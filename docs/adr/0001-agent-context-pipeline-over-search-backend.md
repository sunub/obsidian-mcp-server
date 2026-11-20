# Define RAG as the agent context pipeline, not the search backend

This project treats RAG as the end-to-end Agent Context Pipeline that retrieves vault material, selects relevant evidence, compresses it, and provides it as working context to an AI agent. Search engines such as Elasticsearch are valid retrieval backend alternatives, but they do not replace the context selection, evidence preservation, compression, and memory packet responsibilities that make the system useful for long-running agent work.

## Considered Options

- Keep the original inverted index only: simple and local, but limited to lexical overlap and weak at selecting semantically related context.
- Use Elasticsearch as the primary backend: powerful and capable of lexical, semantic, hybrid, and RRF retrieval, but it introduces a separately operated search engine that does not fit the default local-only goal.
- Use an embedded local retrieval stack: keeps installation, privacy, and operation aligned with Obsidian/MCP usage while still supporting semantic retrieval and reranking.

## Consequences

The retrieval backend should remain swappable in principle, but documentation and product language should describe the larger Agent Context Pipeline rather than equating RAG with a specific vector database or search engine. The default backend should avoid external services and separately operated engines, and context collection should be entered through explicit user-visible triggers instead of always-on background retrieval.
