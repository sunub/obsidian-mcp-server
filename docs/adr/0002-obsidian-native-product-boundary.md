---
status: accepted
---

# Make Obsidian the sole product surface

The product will move away from an MCP-server boundary and become a desktop-only Obsidian-native agent workspace. The existing Agent Context Pipeline—vault retrieval, evidence selection, context compression, and local-first model support—remains product scope, but its primary consumer is the Obsidian experience rather than external MCP clients or the development CLI.

## Considered Options

- Keep the MCP server as the product and improve the development CLI: preserves external-agent compatibility, but keeps the primary experience outside Obsidian and duplicates capabilities Obsidian already provides.
- Add an Obsidian client while retaining the MCP server as the engine: reuses the current boundary, but preserves installation and lifecycle complexity that is not needed for an Obsidian-only product.
- Make Obsidian the sole product surface: gives the agent direct access to active notes, selections, links, properties, and workspace state, at the cost of external MCP compatibility and a substantial runtime refactor.

## Consequences

The CLI becomes a development and diagnostic harness rather than a user-facing product. MCP transport and server registration are not architectural requirements for the new product. Retrieval and context capabilities should be separated from filesystem, stdio, and terminal concerns so they can be consumed through Obsidian-native adapters. Mobile compatibility is not an initial requirement.

The initial Agent Harness runs inside the desktop plugin and calls a separately installed local model provider such as Ollama or llama.cpp over its local API. The product will not introduce its own companion engine process initially; heavy work must use bounded background execution inside the plugin. A companion process may be reconsidered only when measured stability or performance limits justify the added installation and lifecycle complexity.
