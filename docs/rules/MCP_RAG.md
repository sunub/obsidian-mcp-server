# MCP & RAG System Guidelines

## 1. Project Overview & Goals

* **Project Definition:** An MCP (Model Context Protocol) server integrating with an Obsidian Vault, built on TypeScript and Node.js.
* **Extended Goal:** Build a fully local RAG (Retrieval-Augmented Generation) system without relying on external cloud services or APIs.
* **Key Technique (Contextual RAG):** Append the original document's context to markdown chunks before performing embeddings to preserve semantic meaning.

## 2. Tech Stack & Constraints

Strictly adhere to the following constraints for the RAG architecture.

* **Vector DB:** Do not use external storage (e.g., AWS S3). Implement a local file-system-based LanceDB using the `vectordb` package.
* **Embedding & LLM:** Do not write code for external API calls (e.g., OpenAI, Anthropic). Handle all requests by targeting a local Ollama REST API.
* **Environment:** Strictly use TypeScript within a Node.js environment.

## 3. Core Workflows (Contextual RAG)

Implement the RAG system strictly following this sequence:

1. **Parsing & Chunking:** Utilize the existing `MatterParser` to separate Frontmatter from the body text, then divide the body into appropriately sized chunks.
2. **Contextualizing:** Before embedding, request the local Ollama model to generate a summary context of the parent document and prepend/append it to the respective chunk.
3. **Embedding & Storage:** Vectorize the contextualized chunk using the local model, then store it in a LanceDB table along with metadata (e.g., exact file path).
4. **Retrieval:** Upon receiving a semantic search query, perform a vector search and return the highly relevant chunks along with their full file paths to the LLM.
