# Obsidian MCP Server Context

This glossary defines the product language for Obsidian MCP Server as a context layer for AI agents.

## Language

**Vault Context Layer**:
An Obsidian Vault used as a long-term context source that AI agents can retrieve from and compress into usable working context.
_Avoid_: Search index, note searcher

**Context Compression**:
The act of turning relevant vault material into a smaller, evidence-bearing context packet that an AI agent can use without reading every source note in full.
_Avoid_: Simple summary, search result

**Context Selection Accuracy**:
The quality of choosing which vault material should be provided to an AI agent for a given task before compression.
_Avoid_: Search accuracy

**Retrieval Backend**:
The interchangeable mechanism used to find candidate vault material before it is selected and compressed for an AI agent.
_Avoid_: RAG replacement

**Local-Only Operation**:
The product constraint that vault retrieval and context preparation should run on the user's machine without relying on external services or separately operated search engines.
_Avoid_: Cloud-backed search, managed vector database, standalone search server

**Explicit Context Trigger**:
A user-visible signal, such as a vault-related command or tool reference, that opens the Vault context collection path for an AI agent.
_Avoid_: Always-on RAG, implicit background search

**Agent Context Pipeline**:
The end-to-end flow that retrieves vault material, selects relevant evidence, compresses it, and provides it as working context to an AI agent.
_Avoid_: Search engine, document lookup
