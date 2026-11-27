# vault-tidy 플러그인

Obsidian Vault의 이미지, 중복, 무제 노트, 빈 폴더를 링크를 지키며 정리한다.

## 확인한 형식

| 항목 | 내용 | 출처 |
|---|---|---|
| 매니페스트 | `.claude-plugin/plugin.json`. 필수 필드는 `name`(kebab-case)뿐이고 `version`, `description`은 선택 | https://code.claude.com/docs/en/plugins-reference |
| 그 밖의 파일 위치 | `.claude-plugin/` 밖, 플러그인 루트에 둔다 | 같은 문서 |
| MCP 서버 | 루트의 `.mcp.json`. `{ "mcpServers": { "<이름>": { "command", "args", "env" } } }` | https://code.claude.com/docs/en/plugins/components |
| 경로 치환 | `command`, `args`, `env`에서 `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}` | 같은 문서 |
| Skill | `skills/<이름>/SKILL.md`. frontmatter의 `description`으로 Claude가 고른다 | 같은 문서 |
| Command | `commands/<이름>.md`. `/<플러그인명>:<이름>`으로 등록된다 (`disable-model-invocation: true`로 수동 호출 전용) | 같은 문서 |
| Hook 설정 | `hooks/hooks.json`, 최상위 `"hooks"` 키, `settings.json`의 `hooks`와 같은 형태 | 같은 문서 |
| Hook 실행 | `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/guard-vault.mjs"]` (셸 없이 실행하는 형태) | https://code.claude.com/docs/en/hooks |
| `PreToolUse` 입력 | 표준 입력 JSON. `tool_name`, `tool_input.command`, `cwd` | 같은 문서 |
| 차단 방식 | 종료 코드 0과 표준 출력 `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` | 같은 문서 |
| 검증 | `claude plugin validate plugin` | https://code.claude.com/docs/en/plugins-reference |
| 로컬 설치 | `claude --plugin-dir ./plugin`, 실행 중 수정은 `/reload-plugins` | https://code.claude.com/docs/en/plugins |

## 슬래시 커맨드

플러그인 `name`이 `vault-tidy`이므로 각 커맨드는 `/vault-tidy:<이름>`으로 호출한다.

| 커맨드 | 파일 | 역할 |
|---|---|---|
| `/vault-tidy:tidy [scope]` | `commands/tidy.md` | Vault 전체 또는 특정 최상위 폴더 정리 시작 |
| `/vault-tidy:undo [runId]` | `commands/undo.md` | 이전 정리 실행을 원상 복구 |
| `/vault-tidy:status` | `commands/status.md` | 문서 수, 검색 인덱스, 로컬 AI 모델 상태 점검 |
| `/vault-tidy:reindex [--force]` | `commands/reindex.md` | CLI로 벡터 인덱스 증분·강제 재색인 |

## 문서에서 확인하지 못한 부분

- `.mcp.json`의 `env`에서 사용자 셸 환경 변수를 `${VAULT_DIR_PATH}`로 넘기는 방식은 이 문서들에 명시돼 있지 않다. 일반 MCP 설정의 `${VAR}` 확장을 따른다고 보고 썼고, 로컬 설치로 확인해야 한다.
- Hook 프로세스는 Claude Code의 환경을 물려받으므로 `VAULT_DIR_PATH`를 그대로 읽는다.
