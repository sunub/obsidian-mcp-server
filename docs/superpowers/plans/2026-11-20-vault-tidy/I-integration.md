# I. 통합 검증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 단위를 합친 상태에서 spec 3장의 실패 조건이 하나도 일어나지 않음을 자동 테스트와 사람 검토로 확인한다.

**Architecture:** 자동 테스트 하나(MCP 클라이언트로 실제 서버 프로세스를 띄워 fixture에 정리 → 되돌리기)와, 사용자 Vault 복사본에 대한 미리보기 검토로 나뉜다. 사용자 원본 Vault에는 아무것도 실행하지 않는다.

**Tech Stack:** `@modelcontextprotocol/sdk` 클라이언트(stdio), Vitest

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (3장 실패 조건, 7.2 I)

## Global Constraints

`00-index.md`의 공통 제약을 따른다. 시작 조건은 C1, C2, D 병합이다.

## Review Focus

- 서버를 실행한 상태에서 실행 기록과 계획 파일이 Obsidian에 보이는 위치에 생기는지: `.vault-tidy/`, `.trash/` 밖에 새 파일이 없어야 한다. Task 1의 테스트가 다룬다.
- `VaultWatcher`가 이동 중에 오류를 내는지: 서버 stderr에 오류 줄이 없어야 한다. Task 1의 테스트가 다룬다.

---

### Task 1: 서버 수준 종단 테스트

**Files:**
- Create: `tests/unit/VaultTidyEndToEnd.test.ts`

**Interfaces:**
- Consumes: 빌드된 서버 `build/index.js`, 도구 `tidy_plan`, `plan_apply`, `plan_undo`, `copyFixture`, `scanVault`, `buildLinkGraph`

- [ ] **Step 1: 테스트 작성**

```ts
test("정리 → 깨진 링크 없음 → 되돌리기 → 원상복구", async () => {
	/* 1. copyFixture, 실행 전 path→hash 맵과 emptyFolders 저장
	   2. StdioClientTransport 로 build/index.js 실행(env VAULT_DIR_PATH=복사본)
	   3. tidy_plan → bulk·per_item 모든 id 승인, needsTitle 에는 "CORS 정리" 제목 → plan_apply
	   4. scan + buildLinkGraph: resolved null 인 ref 는 target "없는노트" 하나
	   5. 노트는 최상위 폴더 경계를 넘지 않음(실행 기록의 note 이동마다 topFolderOf 비교)
	   6. .vault-tidy/, .trash/ 밖의 새 파일은 tidy 결과 경로(attachments/ 등)뿐
	   7. plan_undo → conflicts 빈 배열 → path→hash 맵과 emptyFolders 가 1과 같음
	   8. 서버 stderr 에 "error" 를 포함한 줄이 없음 */
});
```

- [ ] **Step 2: 실행** — `npm run build && npx vitest run tests/unit/VaultTidyEndToEnd.test.ts` → PASS. 실패하면 원인 단위의 담당 파일에서 고치고, 그 단위 테스트에 재현 테스트를 더한다.
- [ ] **Step 3: Commit** — `test: Vault 정리 종단 테스트 추가`

### Task 2: 사용자 Vault 복사본 미리보기 검토

**Files:**
- 없음(결과는 사람이 읽고, 저장소에는 남기지 않는다. 개인 Vault 내용이기 때문이다)

- [ ] **Step 1:** 사용자가 실제 Vault를 임시 폴더로 복사한다(`cp -R <vault> "$TMPDIR/vault-copy"`).
- [ ] **Step 2:** 플러그인을 로컬 설치하고 `VAULT_DIR_PATH`를 복사본으로 둔 Claude Code에서 "Vault 정리해줘"를 실행해 미리보기까지만 받는다.
- [ ] **Step 3:** 사용자가 아래를 확인한다. 루트 `images/`의 이미지가 노트 옆 `attachments/`로 가는가. `스터디/`의 같은 노트가 중복으로 잡히는가. 무제 노트가 비었는지 아닌지 맞게 나뉘는가. 엉뚱한 연산이 있는가.
- [ ] **Step 4:** 문제가 있으면 해당 플래너 단위에 재현 테스트를 더하고 고친다. 원본 Vault에 실행할지는 사용자가 정한다.
