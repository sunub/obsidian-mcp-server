# CLI AI Agent UI Architecture

## 1. CLI AI Agent Data Flow

Implement the CLI UI strictly following these sequential phases:

### Phase 1: Input Infrastructure (Keystroke & Buffer)

* **Components:** * `KeypressProvider`: Set terminal `stdin` to 'Raw Mode'. Parse escape sequences (e.g., `\x1b[A`) into readable string events.
  * `useTextBuffer`: Store typed characters in a `string[]` (line array) and manage the cursor's `(row, col)` position.
* **Logic:** Keystrokes populate the buffer. `Enter` joins the buffer contents into a string.

### Phase 2: Input Preprocessing & Dispatcher

* **Components:** * `handleSubmit`: Detect if the string starts with `/` (command) or is plain text (query).
  * **History Storage:** Save input strings to a local file, enabling retrieval via the up-arrow key.
* **Logic:** `if (text.startsWith('/')) { executeCommand(text) } else { startLlmStream(text) }`

### Phase 3: LLM Streaming Request

* **Components:** * `useLlmStream` (Hook): Send API request, receive stream via `while await (chunk of stream)`, and append chunks to a `pendingResponse` state.
* **Logic:** UI must not block. React state updates must trigger real-time re-renders as chunks arrive.

### Phase 4: State Management & UI Synchronization

* **Components:** * `history` (State): Array of completed conversation objects.
  * `pendingItem` (State): Active response object streaming from the server.
* **Logic:** Clear `pendingItem` upon stream completion and push content to `history`.

### Phase 5: Real-time Rendering & Layout

* **Components:** * `MainContent`: Render `history` past logs, then render dynamically updating `pendingItem` at the bottom.
  * **Scroll-into-view:** Auto-scroll terminal down if response exceeds viewport height.
* **Logic:** Use Ink's `<Static>` component to render past records once, while actively re-rendering only the active stream.

### Phase 6: User Feedback Loop

* **Components:** Execute `buffer.setText('')` immediately when streaming starts. Render a "Thinking..." indicator before the first chunk arrives.

## 2. System Execution Flowchart

1. **[User]** Types `Hello!` -> Presses `Enter`.
2. **[InputPrompt]** Detects `Enter` -> Calls `AppContainer`'s `onSubmit`.
3. **[AppContainer]** Records `Hello!` to history -> Initializes `useLlmStream`.
4. **[useLlmStream]** API request sent -> Stream begins (updates `pendingItem` chunk by chunk).
5. **[MainContent]** Re-renders terminal dynamically as `pendingItem` mutates.
6. **[Complete]** Stream ends -> Move `pendingItem` to `history` -> Await next input.

## 3. Core Target Files

Focus implementation exclusively on:

1. `KeypressContext.tsx`: Raw keystroke data interpreter.
2. `text-buffer-tmp.ts`: 2D coordinate-based editing engine.
3. `useInputHistory.ts`: Hook for managing historical input logs.
4. `useLlmStream.ts`: Hook for API communication and stream state.
5. `AppContainer.tsx`: The primary orchestrator.
