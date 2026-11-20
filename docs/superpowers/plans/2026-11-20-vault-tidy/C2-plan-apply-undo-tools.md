# C2. `plan_apply`, `plan_undo` 도구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 연산을 실행하는 도구와 실행을 되돌리는 도구를 MCP에 등록한다.

**Architecture:** 두 도구 모두 A3의 `applyPlan`, `undoRun`을 감싸는 얇은 층이다. 검색 인덱스 갱신은 따로 하지 않는다. `VaultWatcher`가 파일 이동을 받아 처리하고, 점으로 시작하는 폴더는 무시한다(spec 6.4).

**Tech Stack:** `@modelcontextprotocol/sdk`, zod 3

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (6.1, 6.4, 7.2 C2)

## Global Constraints

`00-index.md`의 공통 제약을 따른다. 시작 조건은 A3 병합이다.

## Review Focus

- `approvedOpIds`가 빈 배열이고 `renames`도 없는 호출: 아무것도 하지 않고 `applied: []`를 돌려준다. 실행 기록도 남기지 않는다. Task 1의 테스트가 다룬다.
- 없는 planId나 runId: 예외가 도구 오류로 바뀌어 돌아간다. Task 1의 테스트가 다룬다.

---

### Task 1: 두 도구 구현과 등록

**Files:**
- Create: `src/tools/plan/apply.ts`, `src/tools/plan/undo.ts`, `src/tools/plan/params.ts`, `src/tools/plan/index.ts`
- Modify: `src/tools/index.ts` (`toolsWithDeps`에 한 줄), `src/shared/vault-ops/apply.ts`는 고치지 않는다
- Test: `tests/unit/PlanTools.test.ts`

**Interfaces:**
- Consumes: `applyPlan`, `undoRun` (A3), `toolJson`, `toolError`, `VaultToolDeps`
- Produces:
  - 도구 `plan_apply` 입력 `{ planId: string; approvedOpIds: string[]; renames?: { path: string; title: string }[] }`, 출력 `toolJson(ApplyResult)`
  - 도구 `plan_undo` 입력 `{ runId: string }`, 출력 `toolJson(UndoResult)`
  - `src/tools/plan/index.ts`가 `export const register = (server: McpServer, deps: VaultToolDeps) => void`로 두 도구를 함께 등록
  - `executeApply(params, deps)`, `executeUndo(params, deps)`를 각각 export

빈 승인 처리: `approvedOpIds.length === 0 && (renames ?? []).length === 0`이면 `applyPlan`을 부르지 않고 `{ runId: "", applied: [], rejected: [], rewrittenLinks: 0, removedFolders: [] }`를 돌려준다. `plan_apply` 설명문에는 "사용자가 미리보기에서 승인한 id만 넘긴다"와 "결과의 runId로 plan_undo를 부를 수 있다"를 영어로 적는다. `annotations`는 `plan_apply`가 `destructiveHint: true`, `plan_undo`가 `destructiveHint: true`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("tidy_plan 계획을 전부 승인하면 실행되고 되돌릴 수 있다", async () => {
	/* copyFixture → buildTidyPlan → executeApply(모든 bulk·per_item id) → applied 길이 확인
	   → executeUndo(runId) → conflicts 빈 배열 → scanVault 해시 맵이 처음과 같음 */
});
test("빈 승인은 아무것도 하지 않는다", async () => { /* runId "" , .vault-tidy/runs 비어 있음 */ });
test("없는 planId는 도구 오류", async () => { /* isError true, text 에 "계획을 찾을 수 없음" */ });
test("없는 runId는 도구 오류", async () => {});
```

첫 테스트는 C1의 `buildTidyPlan`을 쓴다. C1이 아직 병합되지 않았으면 테스트 안에서 `ChangePlan`을 직접 만들어 `savePlan`한다.

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/unit/PlanTools.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx vitest run tests/unit/PlanTools.test.ts && npm run build` → 둘 다 성공
- [ ] **Step 5: Commit** — `feat(plan): plan_apply와 plan_undo MCP 도구 등록`
