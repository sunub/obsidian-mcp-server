# A3. 계획 실행기와 되돌리기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 연산만 검증해 실행하고, 링크가 가리키던 대상을 그대로 유지하며, 모든 변경을 기록해 한 번에 되돌릴 수 있게 한다.

**Architecture:** `apply.ts`가 검증 → 경로 매핑 계산 → 링크 재작성 계산 → 실행 → 기록 순서로 동작한다. 핵심 규칙은 **링크 해석 보존**이다. 모든 링크에 대해 "실행 전 가리키던 파일(옮겨졌다면 새 위치, 휴지통으로 갔다면 `redirectTo`)"을 실행 후에도 가리켜야 하며, 아니면 `linkTargetFor`로 다시 쓴다. 이 규칙 하나로 옮겨진 파일을 가리키는 링크, 옮겨진 노트 안의 상대 경로 링크, 이동 때문에 모호함이 바뀐 링크가 모두 처리된다.

**Tech Stack:** `node:fs/promises`, `node:path/posix`

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (4.1, 4.3, 6.4, 7.2 A3)

## Global Constraints

`00-index.md`의 공통 제약을 따른다. 시작 조건은 A1, A2 병합이다.

## Review Focus

- 링크가 남아 있는 파일을 `redirectTo` 없이 휴지통으로 보내는 연산: 거부한다. Task 1의 테스트가 다룬다.
- 두 연산이 같은 목적지로 옮기려는 경우: 둘 다 거부한다. Task 1의 테스트가 다룬다.
- 실행 도중 오류(예: 권한): 이미 한 변경은 기록에 남아 있어 되돌릴 수 있다. 기록은 항목마다 디스크에 쓴다. Task 3의 테스트가 다룬다.
- 되돌리기 전에 사용자가 옮겨진 노트를 고친 경우: 그 항목만 충돌로 보고하고 덮어쓰지 않는다. Task 4의 테스트가 다룬다.
- 같은 실행을 두 번 되돌리기: 두 번째는 오류다. Task 4의 테스트가 다룬다.

---

### Task 1: 검증 (`checkMoveBoundary`와 연산 검증)

**Files:**
- Modify: `src/shared/vault-ops/boundary.ts` (`checkMoveBoundary`만)
- Create: `src/shared/vault-ops/validate.ts`
- Test: `tests/unit/VaultApplyValidate.test.ts`

**Interfaces:**
- Consumes: `topFolderOf`, `pathKey`, P0 타입, `scanVault`(A1), `buildLinkGraph`(A2)
- Produces:
  - `checkMoveBoundary(input: { from: string; to: string; kind: FileKind; referencingNotes: string[] }): string | null` — 위반 사유 또는 `null`
  - `validateOps(input: { ops: PlanOp[]; plan: ChangePlan; snapshot: VaultSnapshot; graph: LinkGraph }): { accepted: PlanOp[]; rejected: { opId: string; reason: string }[] }`

경계 규칙(spec 4.1):
- `to`가 `EXCLUDED_DIRS` 안이거나 Vault 밖(`..` 포함)이면 거부
- `from`이 루트 파일(`topFolderOf(from) === null`)이면 허용
- `kind === "note"`: `topFolderOf(to) === topFolderOf(from)`일 때만 허용
- `kind === "attachment"`: 위와 같거나, `referencingNotes`가 하나 이상이고 모두 `topFolderOf(to)`와 같은 최상위 폴더에 있으면 허용
- 최상위 폴더 자체를 대상으로 하는 `removeEmptyFolder`는 거부

연산 검증 사유 문자열(그대로 쓴다): `"최상위 폴더 경계를 넘는 이동"`, `"계획 이후 파일이 바뀜"`, `"원본 파일이 없음"`, `"목적지에 파일이 있음"`, `"다른 연산과 목적지가 겹침"`, `"링크가 남아 있어 휴지통으로 보낼 수 없음"`, `"폴더가 비어 있지 않음"`, `"최상위 폴더는 지울 수 없음"`.

- [ ] **Step 1: 실패하는 테스트 작성** — `checkMoveBoundary`의 다섯 규칙 각각, 그리고 `validateOps`의 사유 여덟 개 각각에 대해 한 테스트씩. 스냅샷과 그래프는 `tests/helpers/vaultOps.ts`로 만든다. 예:

```ts
test("노트는 최상위 폴더를 넘지 못한다", () => {
	expect(checkMoveBoundary({ from: "sunub/a.md", to: "resume/a.md", kind: "note", referencingNotes: [] }))
		.toBe("최상위 폴더 경계를 넘는 이동");
});
test("첨부는 참조하는 노트가 모두 같은 최상위 폴더면 따라간다", () => {
	expect(checkMoveBoundary({ from: "images/좋은코드/1.png", to: "좋은코드/attachments/1.png",
		kind: "attachment", referencingNotes: ["좋은코드/좋은코드-Base.md"] })).toBeNull();
});
test("두 연산의 목적지가 같으면 둘 다 거부한다", () => { /* rejected 길이 2, 사유 "다른 연산과 목적지가 겹침" */ });
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/unit/VaultApplyValidate.test.ts` → FAIL
- [ ] **Step 3: 구현.** "계획 이후 파일이 바뀜"은 연산이 건드리는 경로와 그 경로를 링크하는 노트 중 `plan.fileHashes`에 있는 것의 현재 해시가 다를 때다.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(vault-ops): 실행 전 연산 검증과 최상위 폴더 경계 규칙 구현`

### Task 2: 링크 재작성 계산

**Files:**
- Create: `src/shared/vault-ops/rewritePlan.ts`
- Test: `tests/unit/VaultRewritePlan.test.ts`

**Interfaces:**
- Consumes: `resolveTarget`, `linkTargetFor`, `rewriteLink` (A2)
- Produces: `computeRewrites(input: { graph: LinkGraph; moves: Map<string, string>; trashed: Map<string, string | null>; pathsAfter: readonly string[]; readNote: (path: string) => Promise<string> }): Promise<{ notePathAfter: string; before: string; after: string; count: number }[]>`

규칙:
- 휴지통으로 가는 노트의 링크는 다시 쓰지 않는다.
- 각 노트 `n`의 새 위치는 `moves.get(n) ?? n`이다.
- 각 링크의 의도 대상: `resolved`가 `null`이면 건너뛴다. 휴지통으로 가면 `redirectTo`, 옮겨지면 새 위치, 아니면 그대로.
- 새 위치에서 `resolveTarget(target, form, 새 위치, pathsAfter).resolved`가 의도 대상과 다를 때만 `linkTargetFor(의도 대상, 새 위치, form, pathsAfter)`로 다시 쓴다.
- 한 노트 안의 여러 링크는 `end`가 큰 것부터 바꿔서 앞쪽 위치가 밀리지 않게 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("옮긴 이미지를 가리키는 임베드는 suffix를 유지하며 바뀐다", async () => { /* ![[methods.jpeg|300]] → 같은 이름이 유일하면 그대로 둠, 경로가 필요할 때만 바뀜 */ });
test("옮긴 노트 안의 상대 경로 마크다운 링크가 고쳐진다", async () => { /* a/x.md의 [t](../b.md)가 a/sub/x.md로 이동 후 [t](../../b.md) */ });
test("이동으로 이름이 모호해지면 전체 경로로 바꾼다", async () => { /* [[자기소개서]]가 같은 폴더 후보를 잃는 경우 */ });
test("휴지통으로 가는 파일의 링크는 redirectTo로 바뀐다", async () => { /* [[스터디/HTTP]] → 1주차 */ });
test("깨진 링크는 건드리지 않는다", async () => { /* [[없는노트]] 유지, count 0 */ });
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(vault-ops): 링크 해석 보존 기반 재작성 계산 구현`

### Task 3: `applyPlan`

**Files:**
- Modify: `src/shared/vault-ops/apply.ts`
- Test: `tests/unit/VaultApply.test.ts`

**Interfaces:**
- Consumes: `loadPlan`, `writeJournal` (P0), `validateOps`, `computeRewrites`, `scanVault`, `buildLinkGraph`
- Produces: `applyPlan(root: string, request: ApplyRequest): Promise<ApplyResult>` — 계획이 없으면 `Error("계획을 찾을 수 없음: <planId>")`

순서:
1. 계획을 읽고, `approvedOpIds`에 든 `report`가 아닌 연산을 고른다. `renames`는 `plan.needsTitle`에 있는 경로만 받아 `move` 연산(`id = makeOpId("rename", path)`, `tier: "per_item"`, 목적지 `dirname(path)/<제목>.md`)으로 바꾼다. 제목에서 `\ / : * ? " < > | # ^ [ ]`를 빼고 앞뒤 공백을 지운다. 빈 제목은 거부(`"제목이 비어 있음"`).
2. 현재 Vault를 스캔하고 그래프를 만든 뒤 `validateOps`.
3. 필요한 폴더 생성 → 이동(`fs.rename`) → 휴지통 이동(`.trash/<파일명>`, 이미 있으면 `<이름> 1.<확장자>`, `<이름> 2.<확장자>` 순) → 재작성 쓰기 → 승인된 빈 폴더와 이동으로 비게 된 폴더 삭제(최상위 폴더와 루트 제외, 하위 트리에 파일이 없을 때만).
4. 각 단계마다 `JournalEntry`를 더하고 즉시 `writeJournal`한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("fixture 전체 승인 실행 후 깨진 링크는 [[없는노트]] 하나뿐이다", async () => {
	/* copyFixture → 테스트 안에서 직접 만든 ChangePlan(EXPECTED.md의 B1~B4 연산)을 savePlan →
	   applyPlan 전체 승인 → 다시 scan + buildLinkGraph → resolved null 인 ref 가 없는노트 하나 */
});
test("모든 링크는 실행 전과 같은 파일을 가리킨다", async () => {
	/* 실행 전 각 ref 의 (from, 순번) → 의도 대상 계산, 실행 후 같은 노트(새 위치)의 같은 순번 ref 가 그 대상으로 해석 */
});
test("승인하지 않은 연산은 실행되지 않는다", async () => { /* approvedOpIds 일부만 → 나머지 파일 위치 그대로 */ });
test("이름 변경은 needsTitle에 있는 경로만 받는다", async () => { /* 없는 경로 → rejected */ });
test("중간에 실패해도 그때까지의 기록이 남는다", async () => {
	/* 두 번째 이동 목적지 폴더를 읽기 전용으로 만들어 실패 유도 → readJournal 의 entries 에 첫 이동이 있음 */
});
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(vault-ops): 계획 실행기 구현`

### Task 4: `undoRun`

**Files:**
- Modify: `src/shared/vault-ops/apply.ts`
- Test: `tests/unit/VaultUndo.test.ts`

**Interfaces:**
- Produces: `undoRun(root: string, runId: string): Promise<UndoResult>` — 기록이 없으면 `Error("실행 기록을 찾을 수 없음: <runId>")`, 이미 되돌렸으면 `Error("이미 되돌린 실행: <runId>")`

규칙: 기록을 역순으로 적용한다. `rewrite`는 현재 해시가 `afterHash`일 때만 `before`로 되돌린다. `move`와 `trash`는 `to`의 현재 해시가 `hash`이고 `from`이 비어 있을 때만 되돌린다. `createFolder`는 비어 있을 때만 지운다. `removeFolder`는 다시 만든다. 조건이 맞지 않으면 그 항목을 건너뛰고 `conflicts`에 `{ path, reason: "실행 후 바뀜" }`을 넣는다. 끝나면 `undoneAt`을 기록한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("실행 후 되돌리면 모든 파일 해시가 원래와 같다", async () => {
	/* 실행 전 scanVault 의 path→hash 맵과 되돌린 뒤 맵이 toEqual, emptyFolders 도 같음 */
});
test("되돌리기 전에 고친 노트는 충돌로 보고하고 덮어쓰지 않는다", async () => { /* conflicts 길이 1, 파일 내용은 사용자가 고친 그대로 */ });
test("두 번 되돌리면 오류", async () => { /* rejects.toThrow("이미 되돌린 실행") */ });
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(vault-ops): 실행 되돌리기 구현`
