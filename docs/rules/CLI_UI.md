# CLI AI Agent UI Architecture & Project Guidelines

## 1. CLI AI Agent Data Flow

Implement the CLI UI strictly following these sequential phases:

- Phase 1: Input Infrastructure (Keystroke & Buffer)
Components: * KeypressProvider: Set terminal stdin to 'Raw Mode'. Parse escape sequences (e.g., \x1b[A) into readable string events.

useTextBuffer: Store typed characters in a string[] (line array) and manage the cursor's (row, col) position.

Logic: Keystrokes populate the buffer. Enter joins the buffer contents into a string.

- Phase 2: Input Preprocessing & Dispatcher
Components: * handleSubmit: Detect if the string starts with / (command) or is plain text (query).

History Storage: Save input strings to a local file, enabling retrieval via the up-arrow key.

Logic: if (text.startsWith('/')) { executeCommand(text) } else { startLlmStream(text) }

- Phase 3: LLM Streaming Request
Components: * useLlmStream (Hook): Send API request, receive stream via while await (chunk of stream), and append chunks to a pendingResponse state.

Logic: UI must not block. React state updates must trigger real-time re-renders as chunks arrive.

- Phase 4: State Management & UI Synchronization
Components: * history (State): Array of completed conversation objects.

pendingItem (State): Active response object streaming from the server.

Logic: Clear pendingItem upon stream completion and push content to history.

- Phase 5: Real-time Rendering & Layout
Components: * MainContent: Render history past logs, then render dynamically updating pendingItem at the bottom.

Scroll-into-view: Auto-scroll terminal down if response exceeds viewport height.

Logic: Use Ink's <Static> component to render past records once, while actively re-rendering only the active stream.

- Phase 6: User Feedback Loop
Components: Execute buffer.setText('') immediately when streaming starts. Render a "Thinking..." indicator before the first chunk arrives.

## 2. Core Target Files

Focus implementation on:

- `KeypressContext.tsx`

- `text-buffer.ts`

- `useInputHistory.ts`

- `useLlmStream.ts`

- `AppContainer.tsx`

- `type.ts` (For type analysis and expansion)
