# C1. `tidy_plan` 도구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vault를 스캔하고 네 플래너를 돌려 정리 계획을 저장하고, Claude가 사용자에게 보여줄 미리보기를 돌려주는 MCP 도구를 만든다.

**Architecture:** `buildTidyPlan`이 스캔, 그래프, 플래너 실행, 충돌 제거, 범위 필터, 해시 수집, 저장을 맡는다. `index.ts`는 MCP 등록과 입력 검증만 한다. Vault 경로는 `VaultToolDeps.vaultRoot()`로 받는다.

**Tech Stack:** `@modelcontextprotocol/sdk`, zod 3

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (6.1, 7.2 C1)

## Global Constraints

`00-index.md`의 공통 제약을 따른다. 시작 조건은 A1, A2, B1~B4 병합이다. `src/utils`와 `@/config`를 import하지 않는다.

## Review Focus

- `scope`에 없는 폴더 이름이나 `../` 같은 값: 도구 오류(`toolError`)로 돌려준다. Task 2의 테스트가 다룬다.
- 정리할 것이 없는 Vault: 연산 0개인 계획을 저장하고 요약에 0을 보여준다. Task 1의 테스트가 다룬다.
- 한 파일을 두 플래너가 동시에 다루는 경우(중복으로 trash되는 이미지를 첨부 플래너도 옮기려 함): 앞선 플래너의 연산만 남는다. Task 1의 테스트가 다룬다.

---

### Task 1: `buildTidyPlan`

**Files:**
- Create: `src/tools/tidy/buildPlan.ts`, `src/tools/tidy/preview.ts`
- Test: `tests/unit/TidyBuildPlan.test.ts`

**Interfaces:**
- Consumes: `scanVault`, `buildLinkGraph`, `savePlan`, `newPlanId`, `topFolderOf`, `pathKey` (`@shared/vault-ops/index.js`), `planDuplicates`, `planUntitled`, `planAttachments`, `planEmptyFolders` (`./planners/*.js`)
- Produces:
  - `type PlannerName = "duplicates" | "untitled" | "attachments" | "emptyFolders"`
  - `buildTidyPlan(root: string, options: TidyOptions, planners?: PlannerName[]): Promise<{ plan: ChangePlan; preview: TidyPreview }>` — 기본값은 네 개 전부, 실행 순서는 항상 위 순서
  - `type TidyPreview = { planId: string; summary: { bulk: number; per_item: number; report: number; linksAffected: number; needsTitle: number }; bulk: OpView[]; per_item: OpView[]; report: OpView[]; needsTitle: NeedsTitle[] }`
  - `type OpView = { id: string; type: PlanOp["type"]; path: string; to?: string; redirectTo?: string | null; paths?: string[]; reason: string }` — `move`의 `path`는 `from`, `report`의 `path`는 `paths[0]`

규칙:
- 연산이 건드리는 경로: `move`는 `from`, `to`. `trash`는 `path`. `removeEmptyFolder`는 `path`. `report`는 없음. 앞선 플래너가 건드린 경로(`pathKey` 기준)를 건드리는 뒤 연산은 버린다.
- `options.scope`가 있으면 건드리는 경로가 모두 그 최상위 폴더 안인 연산과, `paths`가 모두 그 안인 `report`만 남긴다. `needsTitle`도 같은 기준으로 거른다.
- `fileHashes`: 남은 연산이 건드리는 기존 파일과, 그 파일들을 링크하는 노트의 스냅샷 해시.
- `linksAffected`: 남은 `move`, `trash`의 원래 경로를 가리키는 ref 수.
- `source`는 `"tidy"`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("fixture 전체 계획이 EXPECTED.md의 B1~B4 행과 일치한다", async () => {
	const root = await copyFixture();
	const { plan } = await buildTidyPlan(root, DEFAULT_TIDY_OPTIONS);
	/* EXPECTED.md 의 각 행을 (type, path, to/redirectTo, tier) 기대값 배열로 옮겨 toEqual(expect.arrayContaining(...)) 와 길이 비교 */
});
test("앞선 플래너가 다룬 경로는 뒤 플래너가 다루지 않는다", async () => {
	/* trash 되는 스터디/5주차/Pasted image 1.png 에 대한 move 연산이 없음 */
});
test("scope를 주면 그 최상위 폴더 연산만 남는다", async () => { /* scope "스터디" → 모든 연산 경로가 스터디/ 로 시작 */ });
test("계획이 저장되어 loadPlan으로 읽힌다", async () => {});
test("정리할 것이 없으면 연산 0개", async () => { /* 노트 하나만 있는 tmp vault */ });
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/unit/TidyBuildPlan.test.ts` → FAIL
- [ ] **Step 3: 구현.** `readNote`는 `fs.readFile(path.join(root, p), "utf-8")`.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(tidy): 정리 계획 생성과 미리보기 구현`

### Task 2: MCP 도구 등록

**Files:**
- Create: `src/tools/tidy/index.ts`, `src/tools/tidy/params.ts`
- Modify: `src/tools/index.ts` (`toolsWithDeps`에 한 줄)
- Test: `tests/unit/TidyPlanTool.test.ts`

**Interfaces:**
- Consumes: `toolJson`, `toolError` (`@shared/mcp/toolResult.js`), `VaultToolDeps`
- Produces:
  - 도구 이름 `tidy_plan`
  - 입력: `{ scope?: string; planners?: PlannerName[]; attachmentsFolderName?: string }`
  - 출력: `toolJson(preview)` (`TidyPreview`)
  - `export const register = (server: McpServer, deps: VaultToolDeps) => void`
  - `export const execute = (params: TidyPlanParams, deps: VaultToolDeps) => Promise<CallToolResult>`

도구 설명문은 영어로, 다음을 담는다: 파일을 바꾸지 않고 계획만 만든다는 것, 미리보기를 사용자에게 보여주고 승인받은 id만 `plan_apply`에 넘겨야 한다는 것, `needsTitle` 항목은 노트를 읽고 제목을 지어 `renames`로 넘긴다는 것. `annotations`는 `readOnlyHint: false`(계획 파일을 쓰므로), `destructiveHint: false`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("execute는 미리보기 JSON을 돌려준다", async () => {
	const root = await copyFixture();
	const result = await execute({}, { vaultRoot: () => root });
	const preview = JSON.parse((result.content[0] as { text: string }).text);
	expect(preview.planId).toMatch(/^\d{8}-\d{6}-/);
});
test("없는 scope는 도구 오류", async () => { /* scope "없는폴더" → isError true */ });
test("경로 탈출 scope는 도구 오류", async () => { /* scope "../x" → isError true */ });
test("Vault 경로가 비어 있으면 도구 오류", async () => { /* vaultRoot: () => "" → isError true */ });
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현.** `scope`는 `/`, `\`, `..`을 포함하면 거부하고, 스냅샷의 최상위 폴더 목록에 없으면 거부한다.
- [ ] **Step 4: 통과 확인** — `npx vitest run tests/unit/TidyPlanTool.test.ts && npm run build` → 둘 다 성공
- [ ] **Step 5: Commit** — `feat(tidy): tidy_plan MCP 도구 등록`
