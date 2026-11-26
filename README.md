# Obsidian MCP Server

[![npm version](https://img.shields.io/npm/v/@sunub/obsidian-mcp-server.svg)](https://www.npmjs.com/package/@sunub/obsidian-mcp-server)

`obsidian-mcp-server`는 Obsidian Vault의 Markdown 문서를 AI 에이전트가 조회하고, 관련 근거를 선별하고, 컨텍스트로 압축해 활용할 수 있게 해주는 로컬 우선 MCP 서버입니다.

이 프로젝트에서 RAG는 특정 벡터 DB나 검색 엔진 선택을 뜻하지 않습니다. RAG는 Vault에서 후보 문서를 찾고, Agent 작업에 맞는 근거를 고르고, 컨텍스트 윈도우에 맞게 압축해 제공하는 **Agent Context Pipeline**입니다.

## 핵심 방향

- **로컬 우선 동작**: 외부 서비스나 별도로 운영해야 하는 검색 엔진 없이 사용자 머신에서 Vault 검색과 컨텍스트 준비를 수행합니다.
- **컨텍스트 선별**: 키워드 검색과 시맨틱 검색을 결합해 Agent에게 제공할 근거 후보를 찾습니다.
- **명시적 RAG 통합**: 모든 프롬프트에 백그라운드 검색을 붙이지 않고, Vault 관련 명령이나 도구 참조가 있을 때 문맥 수집 경로를 엽니다.
- **토큰 절약**: 원문 전체를 밀어넣기보다 excerpt와 검색이 일치시킨 본문 조각 형태로 압축합니다.
- **로컬 모델 기반 검색**: `@huggingface/transformers`, LanceDB, local reranker를 사용해 semantic retrieval을 로컬에서 수행합니다.

Elasticsearch 같은 검색 엔진도 retrieval backend로 사용할 수 있는 대안입니다. 다만 이 프로젝트의 기본 목표는 외부 서비스나 별도 검색 엔진에 의존하지 않는 로컬 단독 작업이므로, embedded retrieval stack을 기본값으로 선택합니다.

## 제공 기능

### MCP Tools

- `vault`
  - `search`: 키워드와 의미 기반 검색을 결합한 하이브리드 후보 탐색
  - `read`: 특정 노트 본문과 메타데이터 조회
  - `list_all`: Vault 문서 목록 조회
  - `stats`: Vault 및 인덱스 상태 조회
  - `collect_context`: 주제로 검색한 문서의 순위, 점수, 일치 조각, 발췌를 배치로 반환
- `write_property`: frontmatter 쓰기
- `tidy_plan`: 첨부 파일, 중복, 무제 노트, 빈 폴더를 정리하는 계획과 미리보기 생성(파일은 바꾸지 않음)
- `plan_apply`: 사용자가 승인한 연산만 실행하고 링크가 같은 파일을 가리키도록 재작성
- `plan_undo`: `plan_apply` 실행을 `runId`로 되돌림

### Retrieval Pipeline

현재 기본 retrieval backend는 다음 순서로 동작합니다.

1. **Keyword Search**: 내부 `Indexer`로 정확한 단어 매칭 후보를 찾습니다.
2. **Vector Search**: LanceDB와 로컬 embedding model로 의미적으로 유사한 청크를 찾습니다.
3. **RRF Fusion**: 키워드 결과와 벡터 결과의 순위를 결합합니다.
4. **Compression**: 필요한 excerpt, source ref, memory packet만 Agent context로 제공합니다.

검색 결과 목록에는 reranker를 적용하지 않습니다. 질의 42개 평가셋에서 reranker가 품질을 높이지 못하고 검색당 수 초를 더 썼기 때문입니다.

로컬 embedding/reranking 모델이 설치되지 않은 경우 서버는 키워드 검색으로 폴백합니다.

## 설치

### 요구사항

- Node.js 22 이상
- 접근 가능한 Obsidian Vault 절대 경로

### MCP 서버 설치 및 모델 준비

```bash
npx @sunub/obsidian-mcp-server setup
```

이 명령은 로컬 semantic search와 reranking에 필요한 모델을 캐시에 설치합니다.

이미 패키지를 설치한 환경에서는 다음처럼 실행할 수도 있습니다.

```bash
obsidian-mcp-server setup
```

모델 설치가 없으면 기본 키워드 검색은 동작하지만, semantic search와 reranking 품질은 사용할 수 없습니다.

## MCP 클라이언트 설정

Claude Desktop, Cursor, Copilot 등 MCP 클라이언트에는 다음처럼 등록합니다.

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "@sunub/obsidian-mcp-server@latest"],
      "env": {
        "VAULT_DIR_PATH": "/Users/username/Documents/MyVault"
      }
    }
  }
}
```

`VAULT_DIR_PATH`는 반드시 본인의 Vault 절대 경로로 바꿔야 합니다.

## 환경 변수

| 환경변수 | 기본값 | 용도 | 필수 |
| --- | --- | --- | --- |
| `VAULT_DIR_PATH` | 없음 | Obsidian Vault 절대 경로 | 예 |
| `LOGGING_LEVEL` | `info` | `debug`, `info`, `warn`, `error` | 아니오 |
| `LOW_CONFIDENCE_DENSE_THRESHOLD` | `0.88` | 검색 결과의 낮은 신뢰도 표시 기준 (`0`~`1`) | 아니오 |

MCP 서버의 Vault 검색/읽기 도구에는 `VAULT_DIR_PATH`가 핵심 설정입니다.

키워드가 일치하는 문서가 없고 의미 검색의 최고 유사도가 `LOW_CONFIDENCE_DENSE_THRESHOLD`보다 낮으면 `search_status.reason`이 `low_confidence`가 됩니다. 검색 결과는 그대로 반환합니다. `0`이면 표시를 끄고, 범위를 벗어나거나 숫자가 아닌 값은 경고를 남긴 뒤 `0.88`을 씁니다. 기본값은 `multilingual-e5-small` 모델과 Vault 하나에서 고른 값입니다.

## 주의 사항

- `VAULT_DIR_PATH`가 없거나 잘못되면 Vault 관련 도구가 동작하지 않습니다.
- semantic search와 reranking을 쓰려면 `setup`으로 로컬 모델을 설치해야 합니다.
- `collect_context`는 긴 주제 정리와 메모리 패킷 생성에 적합하고, 단건 조회는 `search`나 `read`가 더 단순합니다.
- 쓰기 계열 도구는 Vault 바깥 경로에 쓰지 않도록 차단합니다.

## 참고 문서

- [Tool Reference](docs/tool-reference.md)
- [Tool Usage Guide](docs/tools-usage-guide.md)
- [collect_context Guide](docs/collect-context-guide.md)

## 라이선스

Apache-2.0
