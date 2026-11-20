# B1. 첨부 플래너 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미지를 참조하는 노트 폴더의 `attachments/`로 모으는 이동 계획을 만든다.

**Architecture:** 파일 시스템을 건드리지 않는 순수 함수 하나다. 입력은 스냅샷과 링크 그래프이고 출력은 `PlanOp[]`이다. 테스트는 `tests/helpers/vaultOps.ts`로 만든 메모리 입력만 쓴다.

**Tech Stack:** `node:path/posix`

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (4.1 첨부 규칙, 4.2, 7.2 B1)

## Global Constraints

`00-index.md`의 공통 제약을 따른다. 첨부 폴더 이름은 `options.attachmentsFolderName`(기본값 `attachments`)이다. 고정 문자열을 쓰지 않는다.

## Review Focus

- 같은 이미지를 한 노트가 두 번 참조하는 경우: 연산은 하나다. Task 1의 테스트가 다룬다.
- 같은 폴더의 두 이미지가 이동 후 같은 이름이 되는 경우(서로 다른 폴더에서 같은 `attachments/`로 모일 때): 두 번째는 `report`로 남긴다. Task 1의 테스트가 다룬다.
- 노트가 아닌 파일(`.canvas`)이 이미지를 참조하는 경우: 그래프에 없으므로 참조 없음으로 보인다. 이때 이미지는 `report`(참조 없음)로만 남고 이동하지 않는다. Task 1의 테스트가 다룬다.

---

### Task 1: `planAttachments`

**Files:**
- Create: `src/tools/tidy/planners/attachments.ts`
- Test: `tests/unit/TidyAttachmentsPlanner.test.ts`

**Interfaces:**
- Consumes: `Planner`, `PlannerContext`, `PlanOp`, `topFolderOf`, `makeOpId` (`@shared/vault-ops/index.js`)
- Produces: `export const planAttachments: Planner` — `needsTitle`은 항상 빈 배열

규칙(첨부 파일마다, 경로 오름차순):
1. 이 이미지를 `resolved`로 가진 ref의 `from` 노트 목록(중복 제거, 오름차순)을 구한다.
2. 노트가 없으면 `report`, 사유 `"참조하는 노트가 없음"`.
3. 노트들의 최상위 폴더(`null` 포함)가 둘 이상이면 `report`, 사유 `"서로 다른 최상위 폴더의 노트가 함께 사용"`.
4. 이미지의 부모 폴더 이름이 `첨부파일`이면 목적지는 같은 부모의 `attachments/<파일명>`이다.
5. 그 밖에는 목적지를 `dirname(첫 노트)/attachments/<파일명>`으로 한다(첫 노트가 루트면 `attachments/<파일명>`).
6. 현재 위치가 목적지와 같거나, 이미지의 부모 폴더 이름이 이미 `attachmentsFolderName`이면 연산을 만들지 않는다.
7. 목적지가 다른 파일 경로나 앞서 만든 연산의 목적지와 `pathKey`로 겹치면 `report`, 사유 `"목적지에 같은 이름의 파일이 있음"`.
8. 그 밖에는 `move`(`tier: "bulk"`, `id: makeOpId("move", 원래 경로)`), 사유 `"노트 옆 attachments 폴더로 이동"`.

`report` 연산의 `id`는 `makeOpId("report", "attachments:" + 경로)`다.

- [ ] **Step 1: 실패하는 테스트 작성** — T0 `EXPECTED.md`의 B1 행마다 하나씩, 그리고 Review Focus 세 가지. 예:

```ts
test("루트 images 폴더의 이미지는 참조하는 노트 옆으로 돌아간다", async () => {
	const snapshot = snapshotOf([file("images/좋은코드/1.png"), file("좋은코드/좋은코드-Base.md")]);
	const graph = createLinkGraph([link("좋은코드/좋은코드-Base.md", "images/좋은코드/1.png", "images/좋은코드/1.png", { form: "embed" })]);
	const { ops } = await planAttachments({ snapshot, graph, options: DEFAULT_TIDY_OPTIONS, readNote: notesReader({}) });
	expect(ops).toEqual([expect.objectContaining({ type: "move", from: "images/좋은코드/1.png", to: "좋은코드/attachments/1.png", tier: "bulk" })]);
});
test("첨부파일 폴더는 같은 위치의 attachments로 바뀐다", async () => { /* 스터디/첨부파일/methods.jpeg → 스터디/attachments/methods.jpeg */ });
test("최상위 폴더가 다른 노트들이 함께 쓰면 report", async () => { /* 스터디/shared.png */ });
test("첨부 폴더 이름 옵션을 따른다", async () => { /* attachmentsFolderName: "assets" → .../assets/... */ });
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/unit/TidyAttachmentsPlanner.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(tidy): 첨부 파일 정리 플래너 구현`
