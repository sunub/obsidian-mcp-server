# Obsidian Agent Product Context

This glossary defines the product language for an Obsidian-native workspace where AI agents use Vault knowledge as working context.

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

**Local-First Execution**:
The product policy that model execution, Vault retrieval, and context preparation use local providers by default, while external providers and network tools require explicit user choice.
_Avoid_: Local-only operation, cloud-first execution

**Explicit Context Trigger**:
A user-visible signal, such as a vault-related command or tool reference, that opens the Vault context collection path for an AI agent.
_Avoid_: Always-on RAG, implicit background search

**Agent Context Pipeline**:
The end-to-end flow that retrieves vault material, selects relevant evidence, compresses it, and provides it as working context to an AI agent.
_Avoid_: Search engine, document lookup

**Agent Harness**:
The execution environment that governs model selection, tool access, context budgets, permissions, cancellation, retries, and observable run state for an AI agent.
_Avoid_: Model, chatbot, agent framework

**Vault Copilot**:
The initial Obsidian-native experience that answers from the current note and selected Vault evidence, cites its sources, and inserts generated content only after user approval.
_Avoid_: General-purpose chatbot, autonomous note editor
