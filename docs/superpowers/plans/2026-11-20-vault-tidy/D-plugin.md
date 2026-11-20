# D. 플러그인 포장, Skill, Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP 서버, 정리 절차 Skill, Vault 파일 직접 조작을 막는 Hook을 하나의 Claude Code 플러그인으로 묶는다.

**Architecture:** 저장소의 `plugin/` 폴더가 플러그인 루트다. MCP 서버는 npm 패키지를 `npx`로 실행한다. Hook은 의존성 없는 Node 스크립트(`.mjs`)라 빌드가 필요 없다. 서버 코드와 독립적이고, 도구 이름과 입력 형태만 P0, C1, C2 문서에서 가져온다.

**Tech Stack:** Claude Code 플러그인(매니페스트, skills, hooks, MCP 설정), Node 22

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (1장, 4.2, 7.2 D)

## Global Constraints

- `00-index.md`의 공통 제약을 따른다. 단 `plugin/`의 `.mjs`, `.md`, `.json`은 TypeScript 빌드 대상이 아니다.
- 도구 이름은 `tidy_plan`, `plan_apply`, `plan_undo`다(C1, C2).
- 플러그인 디렉터리 구조, 매니페스트 필드, Hook 설정 형식, Hook의 입력과 차단 방식은 **Task 1에서 공식 문서로 확인한 내용을 따른다.** 아래 형식은 작성 시점의 이해이며, 문서와 다르면 문서를 따르고 이 계획의 해당 줄을 고친다.

## Review Focus

- Vault 밖 경로에 대한 `mv`, `rm`: 막지 않는다. Task 3의 테스트가 다룬다.
- `VAULT_DIR_PATH`가 설정되지 않은 환경: Hook은 아무것도 막지 않고 통과한다. Task 3의 테스트가 다룬다.
- Vault 안에서 읽기만 하는 명령(`ls`, `cat`, `grep`): 막지 않는다. Task 3의 테스트가 다룬다.
- 상대 경로 명령(`cd`가 Vault 안이고 `rm 무제.md`): 막는다. Task 3의 테스트가 다룬다.

---

### Task 1: 공식 형식 확인

**Files:**
- Create: `plugin/README.md` (확인한 형식 요약과 출처 URL)

- [ ] **Step 1:** Claude Code 공식 문서에서 플러그인 매니페스트 위치와 필수 필드, 플러그인 안 MCP 서버 설정 위치와 환경 변수 전달 방식, Skill 파일 위치와 frontmatter, Hook 설정 위치, `PreToolUse` 입력 JSON의 필드 이름(명령 문자열과 작업 폴더), 도구 호출을 막는 방법(종료 코드 또는 출력 JSON)을 확인한다.
- [ ] **Step 2:** 확인한 내용을 `plugin/README.md`에 표로 적고, 이 계획의 Task 2~4 경로가 다르면 고친다.
- [ ] **Step 3: Commit** — `docs(plugin): 플러그인 형식 확인 결과 기록`

### Task 2: 매니페스트와 MCP 서버 등록

**Files:**
- Create: `plugin/.claude-plugin/plugin.json`, `plugin/.mcp.json`

- [ ] **Step 1:** 매니페스트에 `name: "vault-tidy"`, `version`(`package.json`과 같은 값), 한 줄 설명 "Obsidian Vault의 이미지, 중복, 무제 노트, 빈 폴더를 링크를 지키며 정리한다"를 쓴다.
- [ ] **Step 2:** MCP 설정에 서버 이름 `obsidian`, 명령 `npx`, 인자 `["-y", "@sunub/obsidian-mcp-server@latest"]`, 환경 변수 `VAULT_DIR_PATH`를 사용자 환경에서 넘기는 설정을 쓴다.
- [ ] **Step 3: 확인** — `claude plugin validate plugin`(Task 1에서 확인한 검증 명령이 있으면 그것)이 성공
- [ ] **Step 4: Commit** — `feat(plugin): 플러그인 매니페스트와 MCP 서버 등록`

### Task 3: Vault 보호 Hook

**Files:**
- Create: `plugin/hooks/hooks.json`, `plugin/hooks/guard-vault.mjs`
- Test: `tests/unit/GuardVaultHook.test.ts`

**Interfaces:**
- Produces: `guard-vault.mjs`는 표준 입력으로 Hook 입력 JSON을 받는다. Vault 파일을 바꾸는 명령이면 막고 "Vault 파일은 tidy_plan과 plan_apply로 옮기거나 지우세요. 링크가 깨지지 않게 하기 위해서입니다."를 Claude에게 돌려준다. 그 밖에는 통과한다.

판정 규칙:
- `VAULT_DIR_PATH`가 비어 있으면 통과.
- 명령을 `;`, `&&`, `||`, `|`로 나눈 각 조각의 첫 단어가 `mv`, `rm`, `cp`, `rsync`, `unlink`, `rmdir`, `trash` 중 하나인지 본다.
- 그런 조각의 인자 중 하나라도, 작업 폴더 기준으로 `path.resolve`한 결과가 `VAULT_DIR_PATH` 안이면 막는다. 작업 폴더가 Vault 안이고 인자가 상대 경로여도 막는다.

- [ ] **Step 1: 실패하는 테스트 작성** — `child_process.spawnSync("node", ["plugin/hooks/guard-vault.mjs"], { input: JSON.stringify(hookInput), env: { ...process.env, VAULT_DIR_PATH: vault } })`로 실행하고, 막을 때와 통과할 때의 종료 코드 또는 출력(Task 1에서 확인한 방식)을 검사한다.

```ts
test("Vault 안 파일의 mv는 막는다", () => {});
test("cd로 Vault 안에 있을 때 상대 경로 rm은 막는다", () => {});
test("Vault 밖 rm은 통과", () => {});
test("Vault 안 ls, cat은 통과", () => {});
test("VAULT_DIR_PATH가 없으면 통과", () => {});
test("&&로 이어진 두 번째 명령도 검사한다", () => { /* "ls && rm vault/a.md" → 막음 */ });
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/unit/GuardVaultHook.test.ts` → FAIL
- [ ] **Step 3: 구현** — `hooks.json`은 Bash 도구의 `PreToolUse`에 이 스크립트를 건다.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(plugin): Vault 파일 직접 이동과 삭제를 막는 Hook 추가`

### Task 4: `vault-tidy` Skill

**Files:**
- Create: `plugin/skills/vault-tidy/SKILL.md`

- [ ] **Step 1:** frontmatter의 `description`은 "Obsidian Vault를 정리해 달라는 요청(이미지 정리, 중복 노트, 무제 노트, 빈 폴더, Vault 정돈)에 쓴다"는 뜻을 담는다.
- [ ] **Step 2:** 본문에 아래 절차를 쓴다. `superpowers:writing-skills` 스킬의 작성 원칙을 따른다.
  1. 사용자가 범위를 말하지 않았으면 전체로 `tidy_plan`을 부른다. 특정 폴더를 말하면 `scope`로 넘긴다.
  2. 미리보기를 단계별로 보여준다. `bulk`는 요약 표(건수와 예시 5개)로 보여주고 한 번에 승인받는다. `per_item`은 항목마다 번호를 붙인 표로 보여주고 번호로 고르게 한다. `report`는 "직접 확인이 필요한 항목"으로 보여주고 실행하지 않는다.
  3. `needsTitle` 항목은 노트를 읽고 제목을 제안해 `per_item` 표에 함께 넣는다. 제목 규칙: 본문의 핵심 주제를 담은 명사구, 30자 이내, 같은 폴더의 기존 파일명과 겹치지 않게, 날짜만으로 짓지 않는다.
  4. 사용자가 승인한 id와 제목만 `plan_apply`에 넘긴다. 승인하지 않은 항목은 절대 넘기지 않는다.
  5. 결과에서 `rejected`가 있으면 사유와 함께 보여준다. 마지막에 runId와 "되돌리려면 말씀하세요"를 알린다.
  6. 사용자가 되돌리기를 원하면 `plan_undo`를 부르고 `conflicts`를 보여준다.
  7. Vault 파일을 셸 명령으로 옮기거나 지우지 않는다.
- [ ] **Step 3: 확인** — 플러그인을 로컬 설치해 Claude Code에서 "Vault 정리해줘"라고 했을 때 Skill이 불리는지 확인
- [ ] **Step 4: Commit** — `feat(plugin): vault-tidy 정리 절차 Skill 추가`
