---
description: Obsidian Vault의 로컬 벡터 검색 인덱스를 CLI로 재구축한다
argument-hint: "[--force]"
disable-model-invocation: true
---

# Vault 벡터 인덱스 재색인

전체 벡터 인덱스 구축은 시간이 오래 걸리는 운영 작업이므로 MCP 도구가 아니라 CLI 서브커맨드로 실행한다.

## 인자 처리

- 전달된 인자: `$ARGUMENTS`
- `--force` 또는 `-f`가 포함되면 기존 벡터 캐시를 초기화하고 전체 문서를 처음부터 다시 색인한다.
- 인자가 없으면 변경되었거나 누락된 문서만 증분 색인한다.

## 절차

1. 실행할 범위(증분 색인 vs `--force` 전체 초기화 재색인)를 사용자에게 한 줄로 알린다. `--force`인 경우 시간이 오래 걸릴 수 있음을 함께 알리고 실행 전 확인을 받는다.
2. `VAULT_DIR_PATH` 환경변수가 설정되어 있는지 확인하고, 비어 있으면 먼저 설정을 안내한다.
3. 아래 CLI 명령을 실행한다.
   - 로컬 개발 플러그인(`${CLAUDE_PLUGIN_ROOT}/../build/index.js`가 존재하는 경우):
     `node "${CLAUDE_PLUGIN_ROOT}/../build/index.js" reindex` (옵션이 있으면 `--force` 추가)
   - 배포 패키지 환경:
     `npx -y @sunub/obsidian-mcp-server reindex` (옵션이 있으면 `--force` 추가)
4. 실행 결과를 보고한다.
   - 로컬 임베딩 모델이 없어 실패하면 `npx @sunub/obsidian-mcp-server setup` 실행을 안내한다.
   - 성공하면 색인 모드와 처리된 문서 수를 요약해 알린다.
