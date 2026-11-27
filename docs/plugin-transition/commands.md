# Command로 제공해야 하는 부분

위치: `plugin/commands/` (구현 완료: `tidy.md`, `undo.md`, `status.md`, `reindex.md`)

Skill은 자연어 요청을 보고 모델이 자동으로 선택합니다. 반면 **파괴적 변경의 시작, 명시적 컨텍스트 로딩, 즉시 복구, 무거운 운영 작업**은 사용자의 의도가 분명할 때만 실행돼야 하므로 명시적 슬래시 커맨드(`plugin/commands/*.md`, `disable-model-invocation: true`)로 진입점을 제공합니다.

플러그인 `name`이 `vault-tidy`이므로 Claude Code에서는 `/vault-tidy:<파일명>` 네임스페이스로 등록됩니다.

---

## 1. 커맨드 목록 요약

| 커맨드 | 파일 | 인자 | 연결 대상 (Skill / MCP / CLI) | 목적 |
|---|---|---|---|---|
| `/vault-tidy:tidy` | `plugin/commands/tidy.md` | `[scope]` | `vault-tidy` Skill → `tidy_plan`, `plan_apply` | Vault 전체 또는 특정 최상위 폴더 정돈 시작 |
| `/vault-tidy:undo` | `plugin/commands/undo.md` | `[runId]` | `plan_undo` (+ 최근 `runId` 확인) | 정돈 실행 결과를 즉시 원상 복구하는 안전 탈출구 |
| `/vault-context` (보류) | — | `<topic>` | `vault` `search`, `read` | 주제별 근거 수집. `collect_context` 존폐 결정 후 재검토 |
| `/vault-tidy:status` | `plugin/commands/status.md` | 없음 | `vault(action="stats")` (로컬 모델 상태 포함) | Vault 문서 수, 인덱스·로컬 모델 건강도 점검 |
| `/vault-tidy:reindex` | `plugin/commands/reindex.md` | `[--force]` | CLI `obsidian-mcp-server reindex` | 전체/증분 벡터 인덱스 재구축 (MCP 동기 액션 제거 완료) |

선택 확장(3단계 이후): `/vault-frontmatter <path>` — 특정 노트/초안에 frontmatter 생성·정리를 명시적으로 시작.

---

## 2. 커맨드별 상세 명세

### 2.1 `/vault-tidy [scope]`
- **필요한 이유**: Vault 전체 스캔과 대량 파일 정리는 사용자가 명확히 원할 때 시작하는 작업입니다. 현재는 자연어로 말해서 `vault-tidy` Skill이 매칭되길 기다려야 합니다.
- **동작 흐름**:
  1. `scope` 인자가 있으면 해당 최상위 폴더로 제한해 `tidy_plan` 호출, 없으면 전체 Vault 스캔.
  2. `vault-tidy` Skill의 승인 절차(`bulk` / `per_item` / `report`, `needsTitle` 제목 제안)를 그대로 실행.
  3. 승인 항목만 `plan_apply` 실행 후 `runId` 출력.

### 2.2 `/vault-undo [runId]`
- **필요한 이유**: 정리 직후 예상과 다른 결과가 나왔을 때 긴 자연어 설명 없이 한 번에 되돌릴 수 있는 안전 탈출구가 필요합니다.
- **동작 흐름**:
  1. `runId`를 넘기면 즉시 `plan_undo(runId)` 호출.
  2. `runId`를 생략하면 직전 대화의 `runId` 또는 `.vault-tidy/runs/`의 가장 최근 미복원 실행을 확인한 뒤 사용자 확인을 거쳐 복원(※ 최근 run 조회 도구가 없으면 대화 컨텍스트의 `runId`를 우선 사용하고 없을 때만 안내).
  3. `conflicts`가 있으면 수정된 파일 목록과 사유를 명확히 보고.

### 2.3 `/vault-context <topic>` (보류)
- `docs/rules/MCP_RAG.md`의 **Explicit Context Trigger** 원칙을 따르는 진입점 후보입니다.
- `collect_context`에 의존하지 않습니다. 만들게 되면 `search`로 후보를 찾고 필요한 노트를 `read`합니다.
- 일반 대화로 충분한지 먼저 확인한 뒤 추가합니다([검토 기록](../collect-context-review.md)).

### 2.4 `/vault-status`
- **필요한 이유**: `vault(action="stats")`와 로컬 임베딩/리랭커 모델 준비 여부, `VAULT_DIR_PATH` 설정 상태는 일반 대화 중 AI가 수시로 부를 기능이 아니라 사용자가 환경을 점검할 때 쓰는 진단 기능입니다.
- **동작 흐름**:
  1. `vault_stats` 호출로 문서 수, 인덱스 상태, 로컬 모델 상태 조회.
  2. 로컬 모델이 없으면 `npx @sunub/obsidian-mcp-server setup` 실행 안내를 여기서 출력.

### 2.5 `/vault-reindex`
- **필요한 이유**: 현재 `src/tools/vault/utils/actions/index_rag.ts`의 `index_vault_to_vectordb`는 전체 Vault를 동기식으로 재색인합니다. 대용량 Vault에서는 수십~수백 초가 걸려 MCP 도구 타임아웃을 유발하고, 일반 대화 중 AI가 임의로 호출하면 세션을 막아버립니다.
- **권장 실행 방식**:
  - 일반 대화용 MCP 도구 목록에서는 제거하고, `setup`과 같은 CLI 서브커맨드(`npx @sunub/obsidian-mcp-server reindex`)로 빼거나, MCP를 유지하더라도 `jobId`를 즉시 반환하는 비동기 상태 조회 방식으로 전환한 뒤 `/vault-reindex` Command에서만 호출하도록 제한합니다.
