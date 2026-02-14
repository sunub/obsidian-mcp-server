# Obsidian MCP Server

`obsidian-mcp-server`는 [Model Context Protocol(MCP)](https://modelcontextprotocol.io/docs/getting-started/intro)을 구현한 서버로, 로컬 Obsidian vault의 문서들을 AI 에이전트나 외부 애플리케이션에서 쉽게 탐색하고 관리할 수 있도록 강력한 도구 API를 제공합니다.

Obsidian Vault를 이용해 AI가 활용 가능한 지식 베이스(Knowledge Base)로 확장하여 사용할 수 있게끔 하고 문서 검색, 요약, 정리와 같은 부가적인 작업을 자동화하여 사용자가 핵심적인 "글쓰기 활동"에만 집중할 수 있는 환경을 구축하고자 제작했습니다.

## 핵심 아키텍처

본 서버는 `VaultManager`와 `Indexer`를 중심으로 구축되어 대규모 Vault에서도 높은 성능과 메모리 효율성을 보장합니다.

- **`Indexer` 기반 검색**: 서버 시작 시 가벼운 역 인덱스(Inverted Index)를 생성하여 키워드 검색 시 거의 즉각적인 결과를 반환합니다(O(1)). 전체 파일 내용을 메모리에 상주시키지 않아 메모리 사용량을 최소화합니다.
- **`VaultManager`**: Vault 내의 모든 문서를 효율적으로 관리하며, 파일 시스템과 상호작용하여 문서의 생성, 수정, 삭제를 처리합니다.

## 주요 기능

- **고급 문서 탐색**: `vault` 도구를 통해 키워드 검색, 전체 목록 조회, 특정 문서 읽기, 통계 분석 등 다양한 탐색 기능을 제공합니다.
- **컨텍스트 수집/기억 패킷 생성**: `vault collect_context`로 문서 배치 수집, 압축, continuation 토큰 발급, 메모리 패킷(JSON canonical)을 생성합니다.
- **저장된 메모리 재호출**: `vault load_memory`로 `memory/resume_context.v1.md`를 빠르게 로드해 다음 턴 컨텍스트로 재사용할 수 있습니다.
- **AI 기반 속성 생성**: `generate_property` 도구는 문서 본문을 분석하여 `title`, `tags`, `summary` 등 적절한 frontmatter 속성을 자동으로 생성합니다.
- **안전한 속성 업데이트**: `write_property` 도구를 사용하여 생성된 속성을 기존 frontmatter와 병합하여 파일에 안전하게 기록합니다.
- **첨부 파일 자동 정리**: `organize_attachments` 도구는 문서와 연결된 첨부 파일(예: 이미지)을 자동으로 감지하여 문서 제목에 맞는 폴더로 이동시키고 링크를 업데이트합니다.
- **통합 워크플로우**: `create_document_with_properties`와 같은 도구를 통해 문서 분석부터 속성 생성, 파일 업데이트까지의 전체 과정을 단일 명령으로 실행합니다.
- **신뢰성 및 테스트**: `vitest`를 사용한 End-to-End 테스트와 GitHub Actions 기반의 CI/CD 파이프라인을 통해 서버의 안정성과 각 도구 API의 응답 스키마를 검증합니다.

## 도구 API

`obsidian-mcp-server`는 MCP 클라이언트를 통해 호출할 수 있는 다음과 같은 도구들을 제공합니다.

### `vault`

Vault 내 문서를 탐색하고 분석하는 핵심 도구입니다. `action` 파라미터를 통해 다양한 기능을 수행할 수 있습니다.

- **`list_all`**: Vault 내 모든 문서의 목록과 메타데이터를 반환합니다.
- **`search`**: 키워드를 기반으로 문서 제목, 내용, 태그를 검색합니다.
- **`read`**: 특정 파일의 내용을 읽고 frontmatter와 본문을 반환합니다.
- **`stats`**: Vault 내 모든 문서의 통계(단어, 글자 수 등)를 제공합니다.
- **`collect_context`**: 문서를 배치 처리하여 메모리 패킷을 생성하고, 필요 시 `memory/resume_context.v1.md`에 저장합니다.
- **`load_memory`**: 저장된 메모리 노트의 canonical JSON 블록을 파싱하여 빠른 재주입용 payload를 반환합니다.

### `generate_property`

문서 경로(`filePath`)를 입력받아 해당 문서의 내용을 분석하고, AI가 추천하는 frontmatter 속성을 생성하여 반환합니다.

### `write_property`

파일 경로(`filePath`)와 JSON 형식의 속성(`properties`)을 입력받아, 해당 파일의 frontmatter를 업데이트합니다.

### `create_document_with_properties`

문서 분석, 속성 생성, 파일 업데이트의 전 과정을 한 번에 처리하는 통합 도구입니다.

### `organize_attachments`

키워드로 문서를 찾아 해당 문서에 연결된 모든 첨부 파일을 `images/{문서 제목}` 폴더로 이동시키고, 문서 내의 링크를 자동으로 업데이트합니다.

## 메모리 운영 원칙

### 서버와 에이전트 책임 분리

- **MCP 서버(Data Plane)**: 검색, 읽기, 압축, continuation, memory packet 생성/저장까지 담당합니다.
- **에이전트 런타임(Memory Plane)**: 사용자 의도 감지, `load_memory` 자동 호출, 다음 턴 프롬프트 선주입을 담당합니다.

중요: 서버만으로는 "다음 턴 자동 기억 반영"을 보장할 수 없습니다. 이 동작은 반드시 클라이언트/에이전트 런타임에서 구현해야 합니다.

### 메모리 산출물 포맷

- 기본 저장 경로: `memory/resume_context.v1.md`
- 구성: 사람이 읽는 Markdown 요약 + AI 파싱용 canonical JSON code block
- 스키마 키: `schema_version`, `generated_at`, `source_hash`, `documents[].doc_hash`, `memory_packet`

## collect_context 추천 프리셋

| 목적 | 주요 파라미터 | 권장 값 |
| --- | --- | --- |
| 빠른 토픽 스캔 | `scope`, `maxDocs`, `maxCharsPerDoc`, `compressionMode` | `topic`, `8`, `700`, `aggressive` |
| 이력서 컨텍스트 구축 | `scope`, `maxDocs`, `maxCharsPerDoc`, `memoryMode`, `compressionMode` | `all`, `20`, `1200`, `both`, `balanced` |
| 장문 Vault 단계 처리 | `maxDocs`, `maxCharsPerDoc`, `maxOutputChars` | `10`, `900`, `2800` |

가드레일은 출력 상한 초과 시 다음 순서로 축소됩니다: `backlinks -> per-doc chars -> doc count -> continuation`.

## 예제 MCP 요청 (3개)

아래는 MCP 클라이언트의 `callTool`에 전달하는 `arguments` 예시입니다.

### 1) 전체 Vault에서 메모리 구축 시작

```json
{
  "action": "collect_context",
  "scope": "all",
  "maxDocs": 20,
  "maxCharsPerDoc": 1200,
  "memoryMode": "both",
  "compressionMode": "balanced"
}
```

### 2) continuationToken으로 다음 배치 이어서 수집

```json
{
  "action": "collect_context",
  "continuationToken": "<previous_response.batch.continuation_token>",
  "compressionMode": "balanced"
}
```

### 3) 저장된 메모리 빠른 로드(quiet)

```json
{
  "action": "load_memory",
  "memoryPath": "memory/resume_context.v1.md",
  "quiet": true
}
```

클라이언트 자동 주입 규칙은 `docs/CLIENT_INJECTION_GUIDE.md`를 참고하세요.

## 설치 및 사용

### MCP 클라이언트 설정

MCP를 지원하는 AI 도구(Claude Desktop, Gemini 등)의 설정 파일에 다음 구성을 추가하세요.

#### Claude Desktop

`claude_desktop_config.json` 파일에 추가해야할 내용:

```json
{
  "mcpServers": {
    "obsidian-mcp-server": {
      "command": "npx",
      "args": ["-y", "@sunub/obsidian-mcp-server"],
      "env": {
        "VAULT_DIR_PATH": "/absolute/path/to/your/obsidian/vault"
      }
    }
  }
}
```

#### Gemini

`gemini_config.json` 파일에 추가해야할 내용:

```json
{
  "mcpServers": {
    "obsidian-mcp-server": {
      "command": "npx",
      "args": ["-y", "@sunub/obsidian-mcp-server"],
      "env": {
        "VAULT_DIR_PATH": "/absolute/path/to/your/obsidian/vault"
      }
    }
  }
}
```

### 설정 확인사항

1. **Vault 경로**: `VAULT_DIR_PATH`에는 반드시 **절대 경로**를 입력해야 합니다.

   ```json
   // ✅ 올바른 예시
   "VAULT_DIR_PATH": "/Users/username/Documents/MyVault"
   "VAULT_DIR_PATH": "C:\\Users\\username\\Documents\\MyVault"  // Windows
   "VAULT_DIR_PATH": "/mnt/c/Users/username/Documents/MyVault"  // WSL
   
   // ❌ 잘못된 예시
   "VAULT_DIR_PATH": "~/Documents/MyVault"  // 상대 경로 사용 불가
   "VAULT_DIR_PATH": "./vault"              // 상대 경로 사용 불가
   ```

2. **Node.js 요구사항**: Node.js 22 이상이 설치되어 있어야 합니다.

   ```bash
   node --version  # v22.0.0 이상 확인
   ```

3. **설정 적용**: 설정 파일 저장 후 AI 도구를 재시작하면 MCP 서버가 자동으로 연결됩니다.

### 수동 실행 (테스트용)

터미널에서 직접 서버를 실행하여 테스트할 수도 있습니다:

```bash
# 환경 변수 설정 후 실행
VAULT_DIR_PATH=/path/to/vault npx -y @sunub/obsidian-mcp-server

# 또는 명령줄 인자로 경로 지정
npx -y @sunub/obsidian-mcp-server --vault-path /path/to/vault
```

### 테스트

`vitest`를 사용한 End-to-End 테스트:

```bash
# 테스트 실행
npm test

# Watch 모드
npm run test:watch
```

### 비용 계측(B1)

`VAULT_METRICS_LOG_PATH`를 지정하면 `vault` 도구 응답마다 아래 메트릭이 JSONL로 기록됩니다.

- `estimated_tokens`
- `mode`
- `truncated`
- `doc_count`

예시:

```bash
# 1) 메트릭 로그 경로 지정
export VAULT_METRICS_LOG_PATH=.tmp/vault-metrics.jsonl

# 2) 평소처럼 MCP 시나리오 실행 (search/read/collect_context/load_memory)
npm run inspector

# 3) 시나리오 종료 후 리포트 생성
npm run metrics:report -- .tmp/vault-metrics.jsonl
```

리포트는 액션별 `count`, `total_tokens`, `avg/p95_tokens`, `avg_doc_count`, `truncated_rate(%)`를 출력합니다.

### 코드 품질

```bash
# 포맷팅
npm run format

# 린팅
npm run lint

# 전체 체크 (포맷팅 + 린팅)
npm run check
```

### CI/CD

이 프로젝트는 GitHub Actions를 사용하여 CI/CD 파이프라인을 구축했습니다:

- **빌드**: TypeScript 컴파일 및 빌드 검증
- **린트**: Biome를 사용한 코드 품질 검사
- **테스트**: Vitest를 통한 E2E 테스트
- **배포**: 태그 푸시 시 자동으로 npm에 배포

## 라이선스

ISC License
