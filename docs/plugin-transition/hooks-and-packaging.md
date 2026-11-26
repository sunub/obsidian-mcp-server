# Hook 안전장치, 패키징·배포, 저장소 정합성

플러그인 1단계 코어(`src/shared/vault-ops` + `tidy`/`plan`)는 동작하지만, **플러그인으로 배포하고 안전하게 쓰기 위해 해결해야 할 인프라·문서·보안 과제**를 따로 정리합니다.

---

## 1. Hook 안전장치 보강 (`plugin/hooks/`)

현재 구현: `plugin/hooks/hooks.json`(Bash `PreToolUse` 매처) + `plugin/hooks/guard-vault.mjs`

### 확인된 사각지대 2가지

1. **`VAULT_DIR_PATH` 미설정 시 조용히 통과 (`guard-vault.mjs` L64-65)**:
   - Hook은 Claude Code 셸 환경의 `process.env.VAULT_DIR_PATH`를 읽습니다.
   - 사용자가 `.mcp.json`에만 `VAULT_DIR_PATH`를 넣고 셸 환경변수에는 설정하지 않으면 `if (!vaultRoot) return;`으로 Hook이 완전히 무력화됩니다.
   - **보강 방향**:
     - 문서와 설치 가이드에서 `VAULT_DIR_PATH`를 셸 환경변수로 설정하는 것을 표준으로 고정(MCP와 Hook이 같은 값을 공유).
     - 또는 `.mcp.json` / 플러그인 설정 파일에서 fallback 경로를 읽거나, 미설정 상태를 `/vault-status`에서 경고.

2. **`Bash` 7개 명령 외 우회 경로 존재**:
   - 현재 `MUTATING_COMMANDS`는 `mv`, `rm`, `cp`, `rsync`, `unlink`, `rmdir`, `trash` 7개만 검사합니다.
   - 차단되지 않는 경로:
     - Claude Code의 `Write` / `Edit` 도구로 Vault 노트를 직접 수정하거나 덮어쓰는 경우(예: 파일 이동 대신 새 경로에 Write 후 기존 파일 삭제 시도, 또는 링크를 깨는 임의 편집)
     - Bash 내 `git mv`, `git rm`, `find ... -delete`, `python -c`, `node -e`, 셸 리다이렉션(`>`, `>>`)
   - **보강 방향**:
     - `guard-vault.mjs`에서 `git mv`/`git rm`, `find`의 `-delete`/`-exec rm`, Vault 경로 대상 리다이렉션(`>`/`>>`) 패턴을 추가 차단.
     - `Write`/`Edit` 도구는 일반 노트 작성 자체를 막으면 안 되므로, **경로 생성/삭제성 오남용**과 **정리 작업 중 직접 쓰기**를 어디까지 막을지 정책을 정한 뒤 `PreToolUse` 매처 확장 여부를 결정.

---

## 2. 플러그인 패키징 및 배포 설정 (`plugin/`, `package.json`)

1. **`plugin/.mcp.json` 로컬 하드코딩 복구 (즉시 필요)**:
   - 현재 워킹트리 diff에서 `plugin/.mcp.json`이 로컬 개발 경로(`node`, `${CLAUDE_PLUGIN_ROOT}/../build/index.js`, `VAULT_DIR_PATH: "<vault-path>"`)로 바뀌어 있습니다.
   - 배포용 설정(`npx -y @sunub/obsidian-mcp-server@latest`, `${VAULT_DIR_PATH}`)으로 복구하고, 로컬 개발 테스트용 설정은 git에 커밋하지 않도록 분리해야 합니다.
2. **`${VAULT_DIR_PATH}` 확장 실제 검증**:
   - `plugin/README.md`(L21-24)에 미확인으로 남아 있는 항목입니다. `claude --plugin-dir ./plugin` 환경에서 `.mcp.json`의 `${VAULT_DIR_PATH}`가 사용자 셸 환경변수로 정상 치환되는지 검증하고 결과를 `plugin/README.md`에 확정 기록합니다.
3. **npm 배포물과 플러그인 배포 경계 정리**:
   - 현재 `package.json`의 `"files": ["build"]`에는 `plugin/`이 포함되지 않습니다.
   - 배포 방식을 명확히 정해야 합니다:
     - **Option A**: npm에는 MCP 서버(`build/`)만 배포하고, Claude Code 플러그인은 GitHub 저장소(`plugin/`) 또는 마켓플레이스 경로로 설치.
     - **Option B**: `package.json` 버전을 올릴 때 `plugin/.claude-plugin/plugin.json`의 `version`도 동기화하는 스크립트/체크를 추가(현재 둘 다 `0.3.31`로 수동 일치).

---

## 3. 문서·규칙 간 정체성 충돌 해소

현재 저장소 안에 **세 가지 서로 다른 제품 정의**가 공존합니다. AI 에이전트나 기여자가 문서를 읽을 때 상충된 지시를 받게 되므로 정리가 필요합니다.

| 파일 | 현재 적힌 정체성 | 정리 방향 |
|---|---|---|
| `plugin/`, `CLAUDE.md`, `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` | **Claude Code 플러그인** (MCP + Skill + Hook) | **현재 저장소의 정식 정체성으로 기준 통일** |
| `docs/adr/0002-obsidian-native-product-boundary.md`, `docs/obsidian-agent-product-handoff.md`, `CONTEXT.md` | **Obsidian 네이티브 데스크톱 플러그인** (MCP 폐기) | 별도 제품/과거 방향 전환 기록(Superseded 또는 별도 프로젝트 이관)으로 상태 명시 |
| `AGENTS.md` (L3) | **Codex 플러그인** | 실제 `plugin/`이 Claude Code 전용인지, Codex도 별도 어댑터로 지원할지 결정 후 표기 통일 |
| `README.md` | 기존 **Obsidian MCP Server** 중심 설명 | 4단계 시점에 플러그인 설치(`plugin/`) + MCP 단독 사용을 함께 안내하도록 개편 |

---

## 4. 워킹트리 및 코드 잔여물 정리 목록

- **구버전 설정 파일**: 루트 `mcp-servers.json` (이미 제거된 `LLM_API_URL`, `LLM_CHAT_MODEL` 환경변수 포함)
- **CLI 분리 후 코드 잔재**: `src/tools/vault/index.ts`, `src/tools/write_property/index.ts`의 `shorthandDescription`
- **로컬 작업 잔여물**: `.claude/worktrees/sharp-cerf-0b7718/` (과거 worktree 잔존 여부 확인 후 정리)
