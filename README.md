# Obsidian MCP Server

[![npm version](https://img.shields.io/npm/v/@sunub/obsidian-mcp-server.svg)](https://www.npmjs.com/package/@sunub/obsidian-mcp-server)

`obsidian-mcp-server`는 Obsidian Vault의 Markdown 문서를 AI 에이전트가 조회하고, 검색하고, 요약할 수 있게 해주는 MCP 서버입니다.

MCP 클라이언트에 연결해 에이전트에게 **토큰 사용량을 제어하면서** Vault 내용을 조회할 수 있게 합니다.

llama.cpp 기반 로컬 LLM(임베딩·채팅·리랭킹)과 연동하면 **외부 API 없이 완전히 로컬에서** Vault RAG를 구축하고 구동할 수 있습니다.

## 무엇을 할 수 있나

- 키워드 기반 노트 검색 (`vault`, `action="search"`)
- 특정 노트 열람 (`vault`, `action="read"`)
- Vault 전체 문서 목록 조회 (`vault`, `action="list_all"`)
- Vault 상태 조회 (`vault`, `action="stats"`)
- RAG 기반 검색 (`vault`, `action="search_vault_by_semantic"`) - LLM 서버(llama.cpp) 연동 필수
- 전체 색인 트리거 (`vault`, `action="index_vault_to_vectordb"`)
- frontmatter 자동 생성 제안 (`generate_property`)
- frontmatter 실제 반영 (`write_property`)
- 이미지 첨부파일 정리 (`organize_attachments`)

## 사전 주의사항

이 서버는 Vault 내용을 클라이언트에 노출합니다. 운영 환경에서 신중히 사용하세요.

- 신뢰할 수 없는 AI 에이전트와 연결하지 마세요.
- Vault 경로(`VAULT_DIR_PATH`)는 최소 권한으로 제한하세요.
- 조회량이 큰 Vault는 `maxOutputChars`, `limit`를 조절해 토큰 비용을 통제하세요.
- `vault` 액션 기본 압축 모드는 `balanced`입니다.

### 설정 확인사항

**1. Vault 경로: `VAULT_DIR_PATH`에는 반드시 절대 경로를 입력해야 합니다.**

```bash
# ✅ 올바른 예시 (macOS / Linux)
VAULT_DIR_PATH="/Users/username/Documents/MyVault"

# ✅ 올바른 예시 (Windows — 역슬래시 이스케이프)
VAULT_DIR_PATH="C:\\Users\\username\\Documents\\MyVault"

# ✅ 올바른 예시 (WSL)
VAULT_DIR_PATH="/mnt/c/Users/username/Documents/MyVault"

# ❌ 잘못된 예시 — 상대 경로는 서버 시작 시 오류 발생
VAULT_DIR_PATH="~/Documents/MyVault"
VAULT_DIR_PATH="./vault"
```

**2. Node.js 요구사항: Node.js 22 이상이 설치되어 있어야 합니다.**

```bash
node --version  # v22.0.0 이상 확인
```

---

### 환경변수 전체 설정 예시

MCP 클라이언트 설정(`mcpServers.env`) 또는 셸 환경변수로 주입합니다.  
시맨틱 검색·리랭킹 기능을 사용하지 않을 경우 `VAULT_DIR_PATH`만 필수입니다.

**최소 설정 (기본 도구만 사용)**

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "@sunub/obsidian-mcp-server@latest"],
      "env": {
        "VAULT_DIR_PATH": "/abs/path/to/your/vault"
      }
    }
  }
}
```

**전체 설정 (시맨틱 검색 + 리랭킹 포함)**

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "@sunub/obsidian-mcp-server@latest"],
      "env": {
        "VAULT_DIR_PATH": "/abs/path/to/your/vault",
        "LOGGING_LEVEL": "info",
        "LLM_API_URL": "http://127.0.0.1:8080",
        "LLM_EMBEDDING_API_URL": "http://127.0.0.1:8081",
        "LLM_EMBEDDING_MODEL": "nomic-embed-text",
        "LLM_CHAT_MODEL": "llama3",
        "LLM_RERANKER_API_URL": "http://127.0.0.1:8082",
        "VAULT_METRICS_LOG_PATH": "/abs/path/to/vault-metrics.ndjson"
      }
    }
  }
}
```

각 변수가 연결되는 서버는 아래와 같습니다:

| 환경변수 | 기본값 | 역할 | 필수 여부 |
|---|---|---|---|
| `VAULT_DIR_PATH` | — | Obsidian Vault 절대 경로 | **필수** |
| `LOGGING_LEVEL` | `info` | 로그 수준 (`debug` / `info` / `warn` / `error`) | 선택 |
| `LLM_API_URL` | `http://127.0.0.1:8080` | llama-server 채팅 엔드포인트 | 선택 |
| `LLM_EMBEDDING_API_URL` | `http://127.0.0.1:8081` | llama-server 임베딩 엔드포인트 (벡터 색인 필수) | 선택 |
| `LLM_EMBEDDING_MODEL` | `nomic-embed-text` | 임베딩 모델명 | 선택 |
| `LLM_CHAT_MODEL` | `llama3` | 채팅 모델명 | 선택 |
| `LLM_RERANKER_API_URL` | `http://127.0.0.1:8082` | llama-server 리랭커 엔드포인트 (미설정 시 폴백) | 선택 |
| `VAULT_METRICS_LOG_PATH` | — | 응답 압축·토큰 메트릭 JSONL 기록 경로 | 선택 |

> `LLM_EMBEDDING_API_URL`이 없으면 `search_vault_by_semantic`과 `index_vault_to_vectordb`가 동작하지 않습니다.  
> `LLM_RERANKER_API_URL`에 서버가 없으면 오류 없이 폴백(원래 정렬 유지)됩니다.

## 시작하기 (빠른 설정)

### 1) 공통 요구사항

- 최소 설정은 `VAULT_DIR_PATH` (Vault 절대 경로)입니다.
- MCP 실행 자체는 배포 패키지 기준으로 맞춰 설명합니다.
  - 배포 패키지(`npx`) 사용 (권장)
  - 로컬 `build/index.js`는 개발/디버깅 목적
- 로컬 실행은 마지막 섹션(5)에서 분리 안내합니다.
- Vault 경로가 없으면 시작이 실패합니다.
- 아래 예시는 복붙으로 바로 사용할 수 있도록 정리했습니다.

### 2) 배포 패키지 (`npx`) 설정

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "@sunub/obsidian-mcp-server@latest"],
      "env": {
        "VAULT_DIR_PATH": "/abs/path/to/your/vault",
        "LOGGING_LEVEL": "info"
      }
    }
  }
}
```

CLI 직접 실행:

```bash
npx -y @sunub/obsidian-mcp-server@latest --vault-path /abs/path/to/your/vault --logging-level info
```

### 3) MCP Client configuration

클라이언트별 UI가 다르더라도 `command`/`args`/`env`의 기본 형태는 동일합니다.

> 배포 패키지 기준 핵심: `command="npx"`, `args=["-y","@sunub/obsidian-mcp-server@latest"]`, `env.VAULT_DIR_PATH`

<details>
  <summary>Codex</summary>
  `.codex/config.toml`에 아래처럼 등록합니다.

  ```toml
  [mcp_servers.obsidian]
  command = "npx"
  args = ["-y", "@sunub/obsidian-mcp-server@latest"]
  env = { VAULT_DIR_PATH = "/abs/path/to/your/vault" }
  ```

</details>

<details>
  <summary>Copilot CLI</summary>

  1) `copilot` 실행
  2) `/mcp add`
  3) 아래 값 입력

- **Server name:** `obsidian`
- **Server Type:** `[1] Local`
- **Command:** `npx -y @sunub/obsidian-mcp-server@latest`
- **Environment:** `{ "VAULT_DIR_PATH": "/abs/path/to/your/vault" }`

</details>

<details>
  <summary>Copilot / VS Code</summary>

  버전별 JSON 키 이름이 다를 수 있으므로(예: `servers`/`mcpServers`), 프로젝트 문서에 맞춰 적용하세요.

  ```json
  {
    "mcpServers": {
      "obsidian": {
        "command": "npx",
        "args": ["-y", "@sunub/obsidian-mcp-server@latest"],
        "env": { "VAULT_DIR_PATH": "/abs/path/to/your/vault" }
      }
    }
  }
  ```

</details>

<details>
  <summary>Cursor</summary>

  `Cursor Settings` → `MCP` → `New MCP Server`에서 등록합니다.

  ```json
  {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "@sunub/obsidian-mcp-server@latest"],
      "env": { "VAULT_DIR_PATH": "/abs/path/to/your/vault" }
    }
  }
  ```
  
  ※ 일부 버전은 서버 식별 키명이 다를 수 있으니 설정 화면 안내에 맞춰 붙여넣으세요.
</details>

<details>
  <summary>Gemini CLI</summary>

  패키지 설치형 예시:

  ```bash
  gemini mcp add obsidian npx -y @sunub/obsidian-mcp-server@latest --vault-path /abs/path/to/your/vault
  ```
  
  ※ 일부 Gemini 버전은 `--vault-path` 지원이 다를 수 있으므로, `gemini mcp add`의 최신 문서를 확인하세요.
</details>

### 4) 완성 예시 설정

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": [
        "-y",
        "@sunub/obsidian-mcp-server@latest"
      ],
      "env": {
        "VAULT_DIR_PATH": "/path/to/obsidian-vault",
        "VAULT_METRICS_LOG_PATH": "/path/to/vault-metrics.ndjson",
        "LOGGING_LEVEL": "info",
        "LLM_API_URL": "http://127.0.0.1:8080",
        "LLM_EMBEDDING_API_URL": "http://127.0.0.1:8081",
        "LLM_EMBEDDING_MODEL": "nomic-embed-text",
        "LLM_CHAT_MODEL": "llama3",
        "LLM_RERANKER_API_URL": "http://127.0.0.1:8082"
      }
    }
  }
}

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": [
        "-y",
        "@sunub/obsidian-mcp-server@latest"
      ],
      "env": {
        "VAULT_DIR_PATH": "/path/to/obsidian-vault",
        "VAULT_METRICS_LOG_PATH": "/path/to/vault-metrics.ndjson",
        "LOGGING_LEVEL": "info",
        "LLM_API_URL": "http://127.0.0.1:8080",
        "LLM_EMBEDDING_API_URL": "http://127.0.0.1:8081",
        "LLM_EMBEDDING_MODEL": "nomic-embed-text",
        "LLM_CHAT_MODEL": "llama3",
        "LLM_RERANKER_API_URL": "http://127.0.0.1:8082"
      }
    }
  }
}
```

> 각 변수의 역할과 기본값은 [사전 주의사항 → 환경변수 전체 설정 예시](#환경변수-전체-설정-예시)를 참고하세요.

## 시맨틱 검색 (RAG) 설정

키워드 검색 외에 **의미 기반 벡터 검색**을 사용하려면 임베딩 서버가 필요합니다.

### 활성화 조건

`LLM_EMBEDDING_API_URL`이 가리키는 서버가 실행 중이어야 합니다.  
없으면 `search_vault_by_semantic`과 `index_vault_to_vectordb`가 동작하지 않고,  
`useRagContext`는 자동으로 키워드 검색으로 폴백됩니다.

```bash
# ecosystem.config.cjs 기준 — 임베딩 서버 단독 시작
pm2 start ecosystem.config.cjs --only llama-embedding-server
```

### 초기 색인 실행

서버 연결 후 처음 한 번은 전체 색인을 직접 트리거해야 합니다.

```text
"Vault 전체를 재색인해줘."
```

내부 동작:

```json
{
  "method": "tools/call",
  "params": {
    "name": "vault",
    "arguments": { "action": "index_vault_to_vectordb" }
  }
}
```

이후에는 파일 변경 시 **VaultWatcher가 자동으로 증분 색인**합니다 (mtime 기반).

### 색인 저장 위치

```
{VAULT_DIR_PATH}/.obsidian/vector_cache/   ← LanceDB 데이터 디렉터리
```

- 직접 삭제해도 무방합니다. 다음 `index_vault_to_vectordb` 호출 시 재생성됩니다.
- `LLM_EMBEDDING_MODEL`을 변경하면 서버 시작 시 **자동으로 전체 재색인**이 발생합니다 (INDEX_VERSION 또는 모델명 불일치 감지).

### 검색 전략 흐름

```
사용자 질문
    │
    ▼
search_vault_by_semantic  (벡터 유사도 검색 → 리랭킹)
    │ 결과 없음
    ▼
vault.search              (키워드 폴백)
    │ 결과 없음
    ▼
컨텍스트 없이 LLM 응답
```

<details>
<summary>청크·토큰 파라미터 (파워유저용)</summary>

| 항목 | 값 | 비고 |
|---|---|---|
| 청크 크기 | 500 tokens | tiktoken cl100k 기준 |
| 청크 오버랩 | 50 tokens | |
| 임베딩 최대 토큰 | 500 tokens | 초과 시 비례 잘라냄 |
| 임베딩 접두어 | `search_document: {text}` | nomic-embed-text 형식 |
| 벡터 차원 | 768 | nomic-embed-text 출력 크기 |
| IVF-PQ 인덱스 생성 | 256개 문서 이상 | 미만이면 브루트포스로 동작 |
| 동시 임베딩 요청 | 최대 3 | Semaphore 제한 |

</details>

## 시작 후 빠른 검증

연결이 끝나면 아래 3가지만 먼저 확인하세요.  
문서가 안 열리더라도 어디서 실패했는지 바로 좁힐 수 있습니다.

1) Vault 상태 확인

```text
"Vault 상태를 요약해줘."
```

예상 내부 동작:

```json
{
  "method": "tools/call",
  "params": {
    "name": "vault",
    "arguments": { "action": "stats" }
  }
}
```

정상 동작 시 응답에 `totalFiles`, `isInitialized`, `vaultPath`가 들어갑니다.

1) 검색 인덱스 확인

```text
"노트 제목에 'MCP'가 들어간 문서만 5개 찾아줘."
```

예상 내부 동작:

```json
{
  "method": "tools/call",
  "params": {
    "name": "vault",
    "arguments": {
      "action": "search",
      "keyword": "MCP",
      "limit": 5
    }
  }
}
```

`search`에서 결과가 비어 있으면 인덱싱/경로 또는 키워드 범위를 의심합니다.

1) 문서 읽기 확인

```text
"특정 노트 하나를 읽어줘."
```

예상 내부 동작:

```json
{
  "method": "tools/call",
  "params": {
    "name": "vault",
    "arguments": {
      "action": "read",
      "filename": "예: 어떤 문서 이름"
    }
  }
}
```

`filename`이 틀리면 `{ "error": "Document not found: ..." }`가 오고, `read` 대신 `list_all`으로 후보를 먼저 확인하면 해결이 빠릅니다.

`search`, `list_all`, `load_memory`는 `quiet` 기본값이 `true`라서 기본 응답이 간략해질 수 있습니다.  
필요하면 `quiet: false`, `includeContent: true`, `excerptLength`(또는 `maxOutputChars`)를 함께 써서 상세를 확인하세요.

## 사용 예시

MCP를 어떻게 호출하는지보다 “무슨 동작을 하려고 하는지”가 더 중요합니다.  

마크다운 문서에 작성되어 있는 첨부파일을 정리하는 동작 예시 :

<https://github.com/user-attachments/assets/eb74ec05-09f7-4632-a22c-666b7e844147>

- 특정 문서를 대상으로 문서에 작성되더 있는 이미지 첨부 파일을 정리해달라고 요구할 경우 해당  `images` 폴더 내부에 해당 파일의 이름으로 폴더를 생성하여 정리합니다.
- 정리된 문서는 기존의 작성되어 있던 문서의 연결이 깨지지 않도록 `images` 폴더를 기준으로 연결을 업데이트 합니다.

직접 실행용 질문 예시:

- `README.md`에서 `시작하기 (빠른 설정)`의 `MCP Client configuration` 부분만 찾아줘.
- `docs/tools-usage-guide.md`의 `vault` 설정 예시만 읽고 정리해줘.
- `docs/tool-reference.md`에서 `vault`의 `collect_context` 파라미터만 찾아줘.
- `docs/tools-usage-guide.md`에서 `MCP 서버` 설정 블록만 정리해줘.

자연어 예시는 아래처럼 구체적으로 쓰면 도구가 더 정확하게 동작합니다.

- `"README.md의 시작하기 부분에서 실행 명령 예시만 찾아줘"`
- `"docs/tools-usage-guide.md에서 vault 관련 사용 예시만 찾아서 비교해줘"`
- `"docs/tool-reference.md의 vault.read 파라미터 설명만 읽어줘"`

`vault`는 사용자 질문을 토대로 내부적으로 매핑되어 호출되며, 실제 흐름은 아래처럼 동작합니다.

- `README.md의 시작하기 (빠른 설정)에서 npx 예시만 보여줘`  
  → 핵심 키워드만 추출해 `vault.search`가 먼저 호출됩니다.
- `docs/tool-reference.md의 collect_context 파라미터만 읽어줘`  
  → 먼저 `vault.read`로 문서의 해당 부분을 읽고, 필요 시 `vault.collect_context`로 정리합니다.
- `docs/tools-usage-guide.md에서 frontmatter 처리 과정을 읽어줘`  
  → 문서 위치를 `vault.read`로 찾은 뒤 `generate_property`/`write_property`/`create_document_with_properties`를 순차 호출할 수 있습니다.

동작하는 도구의 호출 흐름은 [사용 예시(도구 호출 흐름)](docs/tool-call-flows.md)에서 구체 JSON 예시와 함께 확인하세요.

## 등록된 도구

<!-- BEGIN AUTO GENERATED TOOLS -->

- **Obsidian Tools (8 actions)**
  - [`vault`](docs/tool-reference.md#vault-action)
    - `search`
    - `read`
    - `list_all`
    - `stats`
    - `collect_context`
    - `load_memory`
    - `search_vault_by_semantic`
    - `index_vault_to_vectordb`
- [`generate_property`](docs/tool-reference.md#generate_property)
- [`write_property`](docs/tool-reference.md#write_property)
- [`create_document_with_properties`](docs/tool-reference.md#create_document_with_properties)
- [`organize_attachments`](docs/tool-reference.md#organize_attachments)

<!-- END AUTO GENERATED TOOLS -->

## 자세한 사용 규약

- 도구 상세 동작, 파라미터 기본값, 실제 응답 형식은 [Tool Reference](docs/tool-reference.md)에서 확인하세요.
- `vault`는 하나의 MCP tool이고 `action` 값으로 실제 동작이 분기됩니다. 오타가 가장 흔한 실패 원인입니다.
- 대규모 Vault에서는 `collect_context`를 `scope="all"`, `maxDocs`를 작게 시작해 단계적으로 확장하세요.
