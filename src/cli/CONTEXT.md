# CLI Context Glossary

This file documents the core terminology, domain boundaries, and architectural patterns used in the CLI subsystem (`src/cli`). It focuses on defining "what" things are and "why" they exist, avoiding implementation details.

## UI State & Rendering

- **Streaming State Synchronization**: The architectural pattern of using a Mutable Ref (`Accumulation Buffer`) to safely synchronize read/write operations during high-frequency async data streams (e.g., LLM chunks). This escapes React's state batching delays and Stale Closures within long-running async closures, while maintaining a mirrored React State (`Pending State`) purely for view updates.
- **Terminal Render Isolation**: The core strategy for preventing layout thrashing and terminal flickering during high-frequency UI updates in React Ink.
  - **History State**: Immutable past data passed to Ink's `<Static>` component. Items here are flushed directly to `stdout` once and permanently escape the React diffing/render cycle, ensuring zero overhead for long conversations.
  - **Pending State**: The actively streaming, mutating state. It relies on standard React state updates (10~30ms intervals) but is physically constrained to a minimal terminal area (height/width) to ensure that the required terminal redraws are extremely cheap and do not cause global layout thrashing.
