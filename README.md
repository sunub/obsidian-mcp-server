# Obsidian MCP Server

[![npm version](https://img.shields.io/npm/v/@sunub/obsidian-mcp-server.svg)](https://www.npmjs.com/package/@sunub/obsidian-mcp-server)

`obsidian-mcp-server`는 Obsidian Vault의 Markdown 문서를 AI 에이전트가 조회하고, 검색하고, 요약할 수 있게 해주는 MCP 서버입니다.

이 프로젝트는 단순히 문서를 읽어오는 것을 넘어, **transformers.js를 활용한 로컬 하이브리드 검색** 기능을 제공하며, 터미널에서 즉시 Vault와 대화할 수 있는 **대화형 CLI AI Agent UI**를 포함하고 있습니다.

## 주요 특징

- 🔍 **하이브리드 검색:** 키워드 검색과 시맨틱(벡터) 검색을 결합하고 RRF(Reciprocal Rank Fusion)와 Reranking을 통해 최적의 결과 제공.
- 🚀 **Zero-Dependency 로컬 AI:** `@huggingface/transformers`를 사용하여 임베딩 및 리랭킹 모델을 Node.js 프로세스 내에서 직접 실행 (외부 API 서버 불필요).
- 💬 **내장 CLI 에이전트:** MCP 도구들을 활용하여 Vault 내용에 대해 질문하고 답변을 받을 수 있는 터미널 기반 UI 제공. [상세 보기](#대화형-cli-ai-agent-ui)
- 📦 **토큰 최적화:** AI 에이전트의 토큰 사용량을 제어하기 위한 다양한 압축 모드와 출력 제한 기능 제공.

## 무엇을 할 수 있나 (MCP Tools)

- **통합 검색 (`vault`, `action="search"`)**: 키워드와 의미 기반 검색을 동시에 수행하여 관련성 높은 문서 탐색.
- **문서 열람 (`vault`, `action="read"`)**: 특정 노트의 본문 및 메타데이터 조회.
- **전체 목록 및 상태 (`vault`, `action="list_all"|"stats"`)**: Vault의 전반적인 상태와 파일 목록 확인.
- **컨텍스트 수집 (`vault`, `action="collect_context"`)**: 특정 주제와 연관된 고밀도 지식 패킷 생성.
- **지식 로드 (`vault`, `action="load_memory"`)**: 저장된 메모리 스냅샷 호출.
- **Frontmatter 관리 (`generate_property`|`write_property`)**: AI 기반 메타데이터 생성 및 반영.
- **첨부파일 정리 (`organize_attachments`)**: 문서 내 이미지를 전용 폴더로 자동 이동 및 링크 업데이트.

---

## 설치 및 설정

### 1. 사전 요구사항

- **Node.js**: v22.0.0 이상
- **Obsidian Vault**: 절대 경로를 알고 있어야 합니다.

### 2. 로컬 AI 모델 설치 (필수)

시맨틱 검색 및 리랭킹 기능을 활성화하려면 아래 명령어를 통해 필요한 로컬 모델을 다운로드해야 합니다.

```bash
# 로컬 임베딩 및 리랭킹 모델 설치
npx @sunub/obsidian-mcp-server setup
```

또는 이미 패키지를 설치했다면:

```bash
obsidian-mcp-server setup
```

이 명령어는 `Xenova/paraphrase-multilingual-MiniLM-L12-v2`(임베딩)와 `Xenova/bge-reranker-base`(리랭킹) 모델을 다운로드하여 로컬 캐시에 저장합니다.

### 3. 환경 변수 설정

| 환경변수 | 기본값 | 역할 | 필수 여부 |
|---|---|---|---|
| `VAULT_DIR_PATH` | — | Obsidian Vault 절대 경로 | **필수** |
| `LLM_API_URL` | `http://127.0.0.1:8080` | CLI UI용 채팅 모델 API 엔드포인트 | CLI 사용 시 필수 |
| `LLM_CHAT_MODEL` | `llama3` | 채팅에 사용할 모델명 | CLI 사용 시 필수 |
| `LOGGING_LEVEL` | `info` | 로그 수준 (`debug` / `info` / `warn` / `error`) | 선택 |

---

## MCP 클라이언트 설정 예시

각 클라이언트 설정에서 `env.VAULT_DIR_PATH`를 본인의 Vault 경로로 수정하여 사용하세요.

### Claude Desktop / Cursor / Copilot

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

---

## 하이브리드 검색 동작 방식

기존의 키워드 검색만으로는 찾기 힘든 의미적 연관성을 잡기 위해 다음과 같은 파이프라인을 거칩니다:

1.  **Keyword Search**: 내부 `Indexer`를 통해 정확한 단어 매칭 결과 추출.
2.  **Vector Search**: LanceDB와 `transformers.js` 임베딩을 사용하여 의미적으로 유사한 청크 탐색.
3.  **RRF Fusion**: 두 검색 결과의 순위를 Reciprocal Rank Fusion 알고리즘으로 병합.
4.  **Local Reranking**: 병합된 상위 결과들을 `BGE Reranker` 모델로 다시 평가하여 최종 순위 결정.

모델이 설치되지 않은 경우 자동으로 키워드 전용 모드로 동작하며, 터미널에 `npx @sunub/obsidian-mcp-server setup` 실행 권장 메시지를 표시합니다.

---

## 대화형 CLI AI Agent UI

이 프로젝트에는 Obsidian Vault에 최적화된 **터미널 기반 AI 채팅 인터페이스**가 내장되어 있습니다.

### 특징
- **RAG 통합**: 질문 시 자동으로 Vault에서 관련 컨텍스트를 수집하여 LLM에 전달합니다.
- **실시간 스트리밍**: LLM의 답변과 "생각하는 과정(<think>)"을 실시간으로 렌더링합니다.
- **슬래시 커맨드**: `/search`, `/read`, `/index` 등 MCP 도구를 CLI에서 직접 명령어로 호출 가능합니다.
- **멀티 MCP 관리**: 연결된 모든 MCP 서버의 상태와 도구 목록을 모니터링합니다.

### 실행 방법

1.  **채팅 모델 서버 구동**: `llama.cpp` 또는 `Ollama`와 같은 서버를 OpenAI 호환 모드로 띄웁니다.
    - 예: `llama-server -m models/gemma-2-9b-it.Q4_K_M.gguf --port 8080`
2.  **CLI 실행**:
    ```bash
    # 환경변수와 함께 실행
    VAULT_DIR_PATH="/your/vault" LLM_API_URL="http://localhost:8080" npx @sunub/obsidian-mcp-server
    ```

### 슬래시 커맨드 도움말
- `/search <keyword>`: 하이브리드 검색 실행
- `/read "filename"`: 특정 문서 읽기
- `/stats`: Vault 상태 확인
- `/index`: 벡터 DB 재색인 강제 실행
- `/tools`: 사용 가능한 모든 MCP 도구 목록 확인
- `/help`: 도움말 보기

---

## 라이선스

Apache-2.0
