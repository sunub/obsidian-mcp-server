# B4. 빈 폴더 플래너 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비어 있는 하위 폴더를 지우는 계획과, 비어 있는 최상위 폴더 알림을 만든다.

**Architecture:** 순수 함수 하나다. 스냅샷의 `emptyFolders`만 쓴다. 다른 연산 때문에 나중에 비게 되는 폴더는 A3이 실행 끝에 처리하므로 여기서 다루지 않는다.

**Tech Stack:** TypeScript

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (4.1, 4.2, 7.2 B4)

## Global Constraints

`00-index.md`의 공통 제약을 따른다.

## Review Focus

- 빈 폴더 안의 빈 폴더(`AI/무제/안쪽`): 가장 바깥 빈 하위 폴더 하나만 연산으로 만든다. Task 1의 테스트가 다룬다.
- 빈 최상위 폴더 안의 빈 하위 폴더: 최상위는 `report`, 하위 폴더는 연산을 만들지 않는다(최상위 알림으로 충분). Task 1의 테스트가 다룬다.

---

### Task 1: `planEmptyFolders`

**Files:**
- Create: `src/tools/tidy/planners/empty-folders.ts`
- Test: `tests/unit/TidyEmptyFoldersPlanner.test.ts`

**Interfaces:**
- Consumes: `Planner`, `makeOpId`, `topFolderOf` (`@shared/vault-ops/index.js`)
- Produces: `export const planEmptyFolders: Planner`

규칙:
1. `emptyFolders` 중 상위 폴더도 `emptyFolders`에 있는 것은 뺀다.
2. 남은 것이 최상위 폴더(경로에 `/`가 없음)면 `report`(`id: makeOpId("report", "empty-top:" + 경로)`), 사유 `"비어 있는 최상위 폴더"`.
3. 그 밖에는 `removeEmptyFolder`(`tier: "bulk"`, `id: makeOpId("removeEmptyFolder", 경로)`), 사유 `"비어 있는 폴더"`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("가장 바깥 빈 하위 폴더만 지운다", async () => {
	const snapshot = snapshotOf([file("AI/LLM.md")], { emptyFolders: ["AI/무제", "AI/무제/안쪽", "스터디/빈폴더"] });
	const { ops } = await planEmptyFolders({ snapshot, graph: createLinkGraph([]), options: DEFAULT_TIDY_OPTIONS, readNote: notesReader({}) });
	expect(ops.map((o) => o.type === "removeEmptyFolder" && o.path)).toEqual(["AI/무제", "스터디/빈폴더"]);
});
test("빈 최상위 폴더는 report만", async () => { /* emptyFolders: ["빈최상위", "빈최상위/안"] → report 1개, 다른 연산 없음 */ });
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/unit/TidyEmptyFoldersPlanner.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(tidy): 빈 폴더 정리 플래너 구현`
