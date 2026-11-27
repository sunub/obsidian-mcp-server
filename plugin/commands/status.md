---
description: Obsidian Vault 문서 수, 검색 인덱스, 로컬 AI 모델 준비 상태를 점검한다
disable-model-invocation: true
---

# Vault 상태 점검

현재 연결된 Obsidian Vault의 문서 수, 검색 인덱스, 로컬 임베딩·리랭커 모델 준비 상태를 점검한다.

## 절차

1. `vault` 도구를 `action: "stats"`로 호출한다.
2. 응답을 바탕으로 아래 항목을 간결하게 보고한다.
   - Vault 경로(`vaultPath`)와 초기화 여부(`isInitialized`)
   - 전체 문서 수(`totalFiles`)
   - 벡터 색인 상태(`ragStatus`: `isIndexing`, `processed`/`total`, `progress`)
   - 로컬 AI 모델 준비 상태(`localModels.embedderReady`, `localModels.rerankerReady`)
3. `localModels.embedderReady` 또는 `localModels.rerankerReady`가 `false`이면, 하이브리드 검색을 활성화하려면 아래 명령을 터미널에서 실행하라고 안내한다.
   - `npx @sunub/obsidian-mcp-server setup` (또는 응답의 `setupCommand`)
4. 도구 호출이 `VAULT_DIR_PATH` 미설정 오류를 반환하면, 셸 환경변수와 플러그인 MCP 설정에 `VAULT_DIR_PATH`를 설정하라고 안내한다.
