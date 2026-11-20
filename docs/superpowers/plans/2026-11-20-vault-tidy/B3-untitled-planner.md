# B3. 무제 노트 플래너 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 빈 무제 노트를 휴지통으로 보내는 계획과, 내용 있는 무제 노트의 "제목 필요" 목록을 만든다.

**Architecture:** 순수 함수 하나다. 제목을 짓는 일은 서버가 하지 않는다. 미리보기만 돌려주고, Claude가 지은 제목은 `plan_apply`의 `renames`로 들어와 A3이 이름 변경 연산으로 바꾼다.

**Tech Stack:** `gray-matter` (이미 의존성에 있음)

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (4.2, 7.2 B3)

## Global Constraints

`00-index.md`의 공통 제약을 따른다. frontmatter 파싱은 `gray-matter`를 직접 쓴다. `src/utils/processor/MatterParser.ts`는 import하지 않는다.

## Review Focus

- 빈 무제 노트를 다른 노트가 링크하는 경우: 휴지통으로 보내지 않고 `report`. Task 1의 테스트가 다룬다.
- frontmatter가 깨진 노트(`---`만 열고 닫지 않음): 예외 없이 "내용 있음"으로 본다. Task 1의 테스트가 다룬다.
- 미리보기가 긴 노트: 300자로 자르고 공백을 한 칸으로 줄인다. Task 1의 테스트가 다룬다.

---

### Task 1: `planUntitled`

**Files:**
- Create: `src/tools/tidy/planners/untitled.ts`
- Test: `tests/unit/TidyUntitledPlanner.test.ts`

**Interfaces:**
- Consumes: `Planner`, `makeOpId` (`@shared/vault-ops/index.js`)
- Produces: `export const planUntitled: Planner`

규칙(노트마다, 경로 오름차순):
1. 파일명이 `/^(무제|untitled)( \d+)?\.md$/i`에 맞는 노트만 본다.
2. `gray-matter`로 본문을 뽑는다. 파싱이 실패하면 원문 전체를 본문으로 본다.
3. 본문이 공백뿐이고 들어오는 ref가 없으면 `trash`(`tier: "per_item"`, `redirectTo: null`, `id: makeOpId("trash", 경로)`), 사유 `"비어 있는 무제 노트"`.
4. 본문이 공백뿐인데 들어오는 ref가 있으면 `report`(`id: makeOpId("report", "untitled-linked:" + 경로)`), 사유 `"비어 있지만 다른 노트가 링크함"`.
5. 본문이 있으면 `needsTitle`에 `{ path, preview }`. `preview`는 본문의 연속 공백을 한 칸으로 줄이고 앞뒤를 자른 뒤 앞 300자다.

- [ ] **Step 1: 실패하는 테스트 작성** — T0 `EXPECTED.md`의 B3 행 네 개와 Review Focus 세 가지. 예:

```ts
test("frontmatter만 있는 무제 노트는 비어 있다", async () => {
	const snapshot = snapshotOf([file("좋은코드/무제.md")]);
	const out = await planUntitled({ snapshot, graph: createLinkGraph([]), options: DEFAULT_TIDY_OPTIONS,
		readNote: notesReader({ "좋은코드/무제.md": "---\ntags: []\n---\n" }) });
	expect(out.ops).toEqual([expect.objectContaining({ type: "trash", path: "좋은코드/무제.md", redirectTo: null })]);
	expect(out.needsTitle).toEqual([]);
});
test("내용 있는 무제 노트는 needsTitle로 간다", async () => {});
test("링크된 빈 무제 노트는 report", async () => {});
test("닫히지 않은 frontmatter는 내용 있음", async () => {});
test("미리보기는 300자이고 공백이 한 칸", async () => {});
test("무제가 아닌 이름은 무시한다", async () => { /* 무제노트.md, 무제-1.md */ });
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/unit/TidyUntitledPlanner.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(tidy): 무제 노트 정리 플래너 구현`
