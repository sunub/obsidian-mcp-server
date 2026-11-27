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

## 환경 변수

`VAULT_DIR_PATH`는 Claude Code를 실행하는 셸에 설정한다. `.mcp.json`이 이 값을 MCP 서버에 넘기고, Hook 프로세스는 같은 환경을 물려받는다.

Claude Code 2.1.332에서 `claude --plugin-dir`로 확인한 동작은 다음과 같다.

| 셸의 `VAULT_DIR_PATH` | MCP 서버가 받는 값 |
|---|---|
| 설정함 (공백이 있는 경로 포함) | 설정한 값 |
| 설정하지 않음 | `${VAULT_DIR_PATH}` 문자열 그대로. 그런 폴더가 없어 서버가 시작하지 않는다 |

## Hook 검사 범위

`Bash` 도구의 명령을 검사해, Vault 파일을 바꾸는 명령을 거부한다.

| 대상 | 거부하는 경우 |
|---|---|
| `mv`, `rm`, `unlink`, `rmdir`, `trash` | 인자가 Vault 안. `xargs`로 받을 때는 앞 파이프가 Vault를 읽은 경우 |
| `cp`, `rsync` | 목적지가 Vault 안. `--remove-source-files`는 원본이 Vault 안인 경우도 포함 |
| `tee`, `>`, `>>` 같은 리다이렉션 | 쓰는 파일이 Vault 안 |
| `find -delete`, `find -exec rm` | 탐색 시작 폴더가 Vault 안 |
| `git mv`, `git rm` | 인자가 Vault 안 (`git rm --cached`는 허용) |

`sudo`, `env`, `command` 같은 감싸는 명령, 환경 변수, 물결표, 괄호로 묶은 명령, `for` 반복문도 따라 검사한다.

다음은 검사하지 않는다. Hook은 실수를 막는 장치이며 의도적인 우회를 막지 못한다.

- `python -c`, `node -e`, `bash -c`처럼 문자열 안에 든 코드
- `while read`나 명령 치환으로 받은 경로
- Vault를 포함하는 상위 폴더를 지우거나 옮기는 명령
- Claude Code의 `Write`, `Edit` 도구
