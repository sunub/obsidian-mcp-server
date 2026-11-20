# E2. 컨텍스트 메모리의 Vault 쓰기 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `collect_context`가 사용자 Vault에 `memory/` 노트를 쓰지 못하게 하고, 그 노트를 읽는 `load_memory` 액션을 없앤다.

**Architecture:** `vault` 도구 안에서만 바꾼다. `collect_context`는 응답으로만 결과를 돌려준다(`memoryMode: "response_only"`와 같은 동작).

**Tech Stack:** TypeScript, zod

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (3장 실패 조건, 7.2 E2)

## Global Constraints

`00-index.md`의 공통 제약을 따른다. 이 단위가 고치는 `src/tools/vault/` 파일에 있는 주석과 `@/utils` import는 CLAUDE.md 규칙대로, 이번에 수정하는 함수 범위 안에서만 정리한다. 사용자 Vault의 `memory/` 폴더는 지우지 않는다. 사용자가 직접 지운다.

## Review Focus

- 예전 클라이언트가 `memoryMode: "vault_note"`나 `action: "load_memory"`를 보내는 경우: zod 검증 오류로 명확히 거부되어야 하고, 조용히 무시되면 안 된다. Task 1의 테스트가 다룬다.

---

### Task 1: `memoryMode`와 `load_memory` 제거

**Files:**
- Modify: `src/tools/vault/params.ts`, `src/tools/vault/index.ts`, `src/tools/vault/utils.ts`, `src/tools/vault/metrics.ts`, `src/tools/vault/types/collect_context.ts`, `src/tools/vault/utils/shared.ts`, `src/tools/vault/utils/actions/collect_context.ts`, `src/tools/vault/utils/constants.ts`
- Delete: `src/tools/vault/utils/actions/load_memory.ts`, `tests/unit/VaultLoadMemory.test.ts`
- Modify: `tests/unit/VaultCollectContext.test.ts`, `tests/unit/VaultManagerWriteBoundary.test.ts`(`CONTEXT_MEMORY_SNAPSHOT_NOTE_PATH`를 import하므로), `docs/tool-reference.md`, `docs/collect-context-guide.md`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/unit/VaultCollectContext.test.ts`에 추가

```ts
test("collect_context는 Vault에 파일을 쓰지 않는다", async () => {
	/* tmp vault 에 노트 몇 개 → collect_context 실행 → 실행 전후 파일 목록이 같음 */
});
test("memoryMode 파라미터는 거부된다", () => {
	expect(vaultParamsSchema.safeParse({ action: "collect_context", topic: "x", memoryMode: "vault_note" }).success).toBe(false);
});
test("load_memory 액션은 거부된다", () => {
	expect(vaultParamsSchema.safeParse({ action: "load_memory" }).success).toBe(false);
});
```

스키마 export 이름은 `src/tools/vault/params.ts`에 있는 실제 이름을 쓴다. 스키마가 알 수 없는 키를 허용하고 있다면 `memoryMode` 거부를 위해 해당 객체를 `.strict()`로 바꾼다.

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/unit/VaultCollectContext.test.ts` → FAIL
- [ ] **Step 3: 구현.** `grep -rn "memoryMode\|load_memory\|loadMemory\|CONTEXT_MEMORY_SNAPSHOT\|memory_write" src tests docs`의 모든 사용처를 지우거나 고친다. 도구 설명문과 `src/server.ts` 안내문에 `load_memory`가 있으면 그 줄도 지운다(`server.ts`는 그 줄만).
- [ ] **Step 4: 통과 확인** — `npm run build && npm test -- --run` → 둘 다 성공, 위 `grep` 결과는 `docs/superpowers/` 아래만 남음
- [ ] **Step 5: Commit** — `refactor(vault): collect_context의 Vault 쓰기와 load_memory 제거`
