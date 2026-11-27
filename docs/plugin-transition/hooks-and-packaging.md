# Hook 안전장치, 패키징·배포, 저장소 정합성

플러그인 1단계 코어(`src/shared/vault-ops` + `tidy`/`plan`)는 동작하지만, **플러그인으로 배포하고 안전하게 쓰기 위해 해결해야 할 인프라·문서·보안 과제**를 따로 정리합니다.

---

## 1. Hook 안전장치 (`plugin/hooks/`)

구현: `hooks.json`(Bash `PreToolUse` 매처), `guard-vault.mjs`, `shell-lex.mjs`, `vault-rules.mjs`

- 셸 명령 검사의 우회 경로와 `cp` 오탐을 고쳤습니다. 검사 범위와 검사하지 않는 경로는 [플러그인 문서](../../plugin/README.md)에 있습니다.
- `VAULT_DIR_PATH`는 셸 환경변수로 설정하는 것을 표준으로 합니다. 설정하지 않으면 Hook은 통과시키지만 MCP 서버도 시작하지 않습니다.

### 결정 필요

- `Write`/`Edit` 도구는 일반 노트 작성 자체를 막으면 안 됩니다. **경로 생성·삭제성 오남용**과 **정리 작업 중 직접 쓰기**를 어디까지 막을지 정한 뒤 `PreToolUse` 매처 확장 여부를 결정합니다.

---

## 2. 플러그인 패키징 및 배포 설정 (`plugin/`, `package.json`)

1. **`0.4.0` 배포 (필요)**: npm의 `0.3.31`에는 `tidy_plan`, `plan_apply`, `plan_undo`, `reindex`가 없어 배포용 `plugin/.mcp.json`(`@latest`)이 동작하지 않습니다. `v0.4.0` 태그를 push하면 `.github/workflows/ci.yml`이 배포합니다.
2. **로컬 개발 설정**: `plugin/.mcp.json`을 로컬 빌드 경로로 바꾼 변경은 커밋하지 않습니다.
3. **npm 배포물과 플러그인 배포 경계 (결정 필요)**: `package.json`의 `"files": ["build"]`에는 `plugin/`이 포함되지 않습니다.
   - **Option A**: npm에는 MCP 서버(`build/`)만 배포하고, 플러그인은 GitHub 저장소 또는 마켓플레이스 경로로 설치합니다. 마켓플레이스로 가려면 `marketplace.json`을 추가해야 합니다.
   - **Option B**: `package.json` 버전을 올릴 때 `plugin/.claude-plugin/plugin.json`의 `version`도 동기화하는 검사를 추가합니다(현재 수동 일치).

---

## 3. 문서 표기 통일

이 저장소의 제품 정의는 **Claude Code 플러그인(MCP + Skill + Hook)** 입니다(`plugin/`).

| 파일 | 현재 표기 | 정리 방향 |
|---|---|---|
| `README.md` | 플러그인 설치 절을 추가함. 소개 문단은 MCP 서버 중심 | 제품 정의를 플러그인으로 바꿀지 결정 |

---

## 4. 워킹트리 및 코드 잔여물 정리 목록

- **구버전 설정 파일**: 루트 `mcp-servers.json` (이미 제거된 `LLM_API_URL`, `LLM_CHAT_MODEL` 환경변수 포함)
- **CLI 분리 후 코드 잔재**: `src/tools/vault/index.ts`, `src/tools/write_property/index.ts`의 `shorthandDescription`
- **로컬 작업 잔여물**: `.claude/worktrees/sharp-cerf-0b7718/` (과거 worktree 잔존 여부 확인 후 정리)
