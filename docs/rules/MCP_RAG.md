# MCP & RAG System Guidelines

## 1. Project Overview & Goals

* **Project Definition:** An MCP (Model Context Protocol) server integrating with an Obsidian Vault, built on TypeScript and Node.js.
* **Extended Goal:** Build a local-first Agent Context Pipeline that retrieves material from an Obsidian Vault, selects task-relevant evidence, compresses it, and provides it as working context to an AI agent.
* **RAG Definition:** In this project, RAG is not a specific vector database or search engine. It is the end-to-end pipeline that turns vault material into usable agent context.
* **Retrieval Backend:** The retrieval backend is interchangeable. Elasticsearch, BM25 engines, SQLite FTS, or other search systems could be used, but the default stack should remain local-only for personal Vault usage.
* **Trigger Policy:** Vault context collection should be entered through explicit user-visible triggers, such as vault-related commands or tool references, rather than always-on background retrieval for every prompt.

## 2. Tech Stack & Constraints

Strictly adhere to the following constraints for the RAG architecture.

* **Vector DB:** Do not use external storage (e.g., AWS S3). The current default retrieval backend uses local file-system storage with LanceDB.
* **Embedding & Reranking:** Prefer local models loaded through `@huggingface/transformers` so semantic search and reranking can run without an external AI API server.
* **Search Alternatives:** Do not frame Elasticsearch or other engines as impossible. They are valid retrieval backend alternatives, but adopting separately operated services or search engines does not fit the project's default local-only MCP package experience.
* **Environment:** Strictly use TypeScript within a Node.js environment.

## 3. Core Workflows (Agent Context Pipeline)

Implement the context pipeline following this sequence:

1. **Parsing & Chunking:** Use `MatterParser` to separate frontmatter from body text, then divide the body into appropriately sized chunks.
2. **Local Context Hints:** Preserve lightweight document context such as title, section heading, outline, tags, and source path with each chunk.
3. **Embedding & Storage:** Vectorize the chunk plus its local context hints, then store it in the local retrieval backend with source metadata.
4. **Hybrid Retrieval:** Combine keyword search and semantic search so exact terms and meaning-based matches can both surface candidate material.
5. **Fusion & Reranking:** Use rank fusion and local reranking to improve context selection accuracy before content is shown to the agent.
6. **Compression & Injection:** Return only the selected excerpts, evidence snippets, source references, and memory packet needed for the agent task.
