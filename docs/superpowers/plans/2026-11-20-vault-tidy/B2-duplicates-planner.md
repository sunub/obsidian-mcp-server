# B2. 중복 플래너 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내용이 같은 파일을 하나만 남기고 나머지를 휴지통으로 보내는 계획을, 이름만 같은 노트는 알림을 만든다.

**Architecture:** 순수 함수 하나다. 해시로 묶고, 정해진 순서로 남길 파일을 고른다. 남기지 않는 파일의 링크는 `redirectTo`로 남기는 파일을 가리키게 한다(실제 재작성은 A3).

**Tech Stack:** TypeScript

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (4.2, 7.2 B2)

## Global Constraints

`00-index.md`의 공통 제약을 따른다.

## Review Focus

- 빈 파일(크기 0)이나 공백만 있는 노트: 묶지 않는다. 무제 노트는 B3이 다룬다. Task 1의 테스트가 다룬다.
- 세 개 이상의 중복: 하나만 남기고 나머지 모두 trash다. Task 1의 테스트가 다룬다.
- 무제 이름 노트(`무제.md` 여러 개): "이름 같고 내용 다름" 알림에서 뺀다. Task 1의 테스트가 다룬다.

---

### Task 1: `planDuplicates`

**Files:**
- Create: `src/tools/tidy/planners/duplicates.ts`
- Test: `tests/unit/TidyDuplicatesPlanner.test.ts`

**Interfaces:**
- Consumes: `Planner`, `makeOpId`, `pathKey` (`@shared/vault-ops/index.js`)
- Produces: `export const planDuplicates: Planner`

무제 이름 판정 정규식 `/^(무제|untitled)( \d+)?\.md$/i`는 이 파일 안에 둔다. B3도 같은 정규식을 자기 파일에 둔다. 플래너끼리 서로 import하지 않게 하기 위해서다.

규칙:
1. 크기가 0인 파일과, 노트 중 `readNote` 결과가 공백뿐인 파일은 제외한다.
2. `kind`가 `note` 또는 `attachment`인 파일을 `hash`로 묶고, 두 개 이상인 묶음만 본다.
3. 남길 파일: 들어오는 ref 수(`graph.inbound(path).length`)가 많은 것 → 경로 조각 수가 많은 것 → `mtimeMs`가 큰 것 → 경로 사전순 앞.
4. 나머지는 `trash`(`tier: "per_item"`, `redirectTo: 남길 파일`, `id: makeOpId("trash", 경로)`), 사유 `"내용이 같은 파일이 <남길 파일>에 있음"`.
5. 노트 중 파일명(`pathKey(basename)`)이 같은데 해시가 다른 것이 둘 이상이면 `report`(`id: makeOpId("report", "same-name:" + 파일명)`), 사유 `"이름은 같고 내용이 다른 노트"`. 무제 이름 정규식에 맞는 이름은 뺀다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("참조 수가 같으면 더 깊은 경로를 남긴다", async () => {
	const snapshot = snapshotOf([file("스터디/HTTP.md", { hash: "x" }), file("스터디/1주차/HTTP.md", { hash: "x" })]);
	const { ops } = await planDuplicates({ snapshot, graph: createLinkGraph([]), options: DEFAULT_TIDY_OPTIONS,
		readNote: notesReader({ "스터디/HTTP.md": "본문", "스터디/1주차/HTTP.md": "본문" }) });
	expect(ops).toEqual([expect.objectContaining({ type: "trash", path: "스터디/HTTP.md", redirectTo: "스터디/1주차/HTTP.md" })]);
});
test("참조 수가 깊이보다 우선한다", async () => { /* 얕은 쪽에 inbound 1 → 얕은 쪽 유지 */ });
test("깊이도 같으면 최근 수정본을 남긴다", async () => {});
test("세 개 중복은 둘을 trash", async () => {});
test("빈 파일은 묶지 않는다", async () => {});
test("이름 같고 내용 다르면 report, 무제는 제외", async () => {});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/unit/TidyDuplicatesPlanner.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(tidy): 중복 파일 정리 플래너 구현`
