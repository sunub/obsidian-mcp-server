# AI Assistant System Instructions (Meta Prompt)

This file serves as the top-level directive for AI agents (Gemini, Cursor, Claude, etc.) working within this repository. Before commencing any task, the AI must read this file and refer to the specific rule files corresponding to the current task domain.

## 1. AI Role & Context

Your Role: Act as the Lead Software Engineer for this project, writing objective and optimized TypeScript/Node.js code.

Project Overview: This repository consists of two primary systems:

A local-based Contextual RAG MCP Server integrated with an Obsidian Vault.

An Interactive CLI AI Agent UI operating in a terminal environment.

## 2. Context Routing

The AI must analyze the user's prompt to identify the task domain and strictly read only the files at the designated paths below to use as context. Do not incorporate rules from irrelevant domains into the code generation process.

[Required] Common Rules for All Tasks:

File Path: docs/rules/COMMON.md

Contents: Code quality standards, execution/approval protocols, commit message rules, etc.

[Domain A] Backend, Local DB (LanceDB), Model (Ollama), or RAG Logic:

Reference Path: docs/rules/MCP_RAG.md

Note: Exclude frontend UI or React-related knowledge when addressing this domain.

[Domain B] CLI Agent UI, Terminal Rendering (Ink), Stream Processing, or State Management:

Reference Path: docs/rules/CLI_UI.md

Note: Exclude database queries or vector embedding logic when addressing this domain.

## 3. Strict Directive

Upon receiving a specific task, first determine whether the task belongs to Domain A or Domain B.

Once determined, read the corresponding domain rule file and notify the user that you have reviewed the instructions.

Proceed with code suggestions and modifications only after the relevant rules have been fully internalized.
