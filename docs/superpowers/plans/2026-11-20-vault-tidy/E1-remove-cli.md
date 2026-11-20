# E1. 개발용 CLI와 로컬 LLM 설정 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클라이언트를 Claude Code가 맡게 되었으므로, 저장소 안의 터미널 AI 클라이언트와 그 클라이언트만 쓰던 설정, 의존성, 테스트를 지운다.

**Architecture:** 코드 추가 없이 삭제만 한다. 지우기 전과 후에 `grep`으로 사용처를 확인해, CLI 밖에서 쓰는 것은 남긴다.

**Tech Stack:** npm, TypeScript

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (7.2 E1)

## Global Constraints

`00-index.md`의 공통 제약을 따른다. `src/server.ts`의 안내문은 P0가 담당하는 파일이지만, 이 단위에서 `LLM_API_URL` 줄 하나만 지운다. 병합 순서는 P0 → E1이다.

## Review Focus

- 지운 의존성을 `scripts/`나 `tests/`의 벤치마크가 쓰는 경우: 빌드는 통과해도 스크립트가 깨진다. Task 2에서 `src/`, `scripts/`, `tests/` 전체를 검사한다.
- 다른 패키지의 peer 의존성인 패키지(`@langchain/core`는 `@langchain/textsplitters`의 peer): import가 없어도 지우지 않는다. Task 2에서 확인한다.
- `llmRerankerApiUrl`처럼 CLI가 아닌 코드(`src/utils/RerankerClient.ts`)가 쓰는 설정: 남긴다. Task 3에서 확인한다.

---

### Task 1: CLI 코드와 CLI 전용 테스트 삭제

**Files:**
- Delete: `src/cli/`, `tests/run_cli_streaming_benchmark.tsx`, `tests/run_cli_paste_benchmark.ts`, `tests/run_cli_streaming_integrity.ts`, `tests/unit/TextBufferPaste.test.ts`, `tests/unit/bootLogo.test.ts`, `tests/unit/McpManager.test.ts`, `tests/unit/ToolExecution.test.ts`, `tests/unit/ConversationCompress.test.ts`, `tests/unit/mcpServersConfig.test.ts`, `tests/unit/InputPromptSubmission.test.ts`
- Modify: `package.json`(`cli`, `benchmark:cli-streaming`, `verify:cli-streaming` 스크립트), `tsconfig.json`(`@cli/*` 별칭, `"jsx"`, `include`의 `src/cli/**/*`), `.gitignore`의 `mcp-servers.json`, `.mcp-servers.json` 줄, README의 "개발용 CLI AI Agent UI" 절

- [ ] **Step 1:** 삭제 전 확인 — `grep -rln "src/cli\|@cli/" src tests scripts`의 결과가 위 삭제 목록과 `src/cli/` 안의 파일뿐인지 본다. 다른 파일이 나오면 그 파일을 고치는 단계를 이 Task에 더한다.
- [ ] **Step 2:** 삭제와 수정
- [ ] **Step 3: 확인** — `npm run build && npm test -- --run` → 둘 다 성공
- [ ] **Step 4: Commit** — `refactor: 개발용 CLI와 CLI 전용 테스트 제거`

### Task 2: 쓰지 않게 된 의존성 제거

**Files:**
- Modify: `package.json`, `bun.lock`

- [ ] **Step 1:** 후보 각각에 대해 `grep -rlE "from \"<pkg>(/[^\"]*)?\"|require\(\"<pkg>" src scripts tests`가 비어 있는지 확인한다. 후보: `ink`, `ink-picture`, `ink-spinner`, `react`, `@types/react`, `clipboardy`, `string-width`, `wrap-ansi`, `strip-ansi`, `ansi-regex`, `tinycolor2`, `@types/tinycolor2`, `tinygradient`, `prompts`, `yargs`, `@types/yargs`, `comment-json`, `ollama`, `mnemonist`, `jsdom`. 비어 있는 것만 지운다. `@langchain/core`는 지우지 않는다.
- [ ] **Step 2:** `npm uninstall <확인된 목록>`, 그리고 `bun.lock`을 쓰는 경우 `bun install`로 잠금 파일을 갱신한다.
- [ ] **Step 3: 확인** — `npm run build && npm test -- --run` → 둘 다 성공
- [ ] **Step 4: Commit** — `chore: CLI 제거로 쓰지 않게 된 의존성 정리`

### Task 3: 로컬 LLM 채팅 설정 제거

**Files:**
- Delete: `src/utils/LLMClient.ts`
- Modify: `src/config.ts`, `src/shared/configSchema.ts`, `src/server.ts`(안내문의 `LLM_API_URL` 줄), README 환경 변수 표

- [ ] **Step 1:** `grep -rn "llmApiUrl\|llmChatModel\|llmContextTokens\|llmTimeoutMs\|LLMClient\|llmClient\|LLM_API_URL\|LLM_CHAT_MODEL\|LLM_CONTEXT_TOKENS\|LLM_TIMEOUT_MS" src scripts tests`로 사용처를 본다. 위 Task 1 이후 남은 사용처가 설정 정의뿐인 항목만 지운다. `llmRerankerApiUrl`은 `RerankerClient`가 쓰므로 남긴다.
- [ ] **Step 2:** 지울 항목을 `config.ts`의 스키마, 기본값, `state` 대입과 `configSchema.ts`에서 함께 지운다. 주석이 있던 줄(`llmContextTokens` 설명)도 함께 지운다.
- [ ] **Step 3: 확인** — `npm run build && npm test -- --run` → 둘 다 성공
- [ ] **Step 4: Commit** — `refactor: 로컬 LLM 채팅 설정과 LLMClient 제거`
