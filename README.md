# Obsidian MCP Server

`obsidian-mcp-server`는 [Model Context Protocol(MCP)](https://modelcontextprotocol.io/docs/getting-started/intro)을 구현한 서버로, 로컬 Obsidian vault의 문서들을 AI 에이전트나 외부 애플리케이션에서 쉽게 탐색하고 관리할 수 있도록 강력한 도구 API를 제공합니다.

## 핵심 아키텍처

본 서버는 `VaultManager`와 `Indexer`를 중심으로 구축되어 대규모 Vault에서도 높은 성능과 메모리 효율성을 보장합니다.

- **`Indexer` 기반 검색**: 서버 시작 시 가벼운 역 인덱스(Inverted Index)를 생성하여 키워드 검색 시 거의 즉각적인 결과를 반환합니다(O(1)). 전체 파일 내용을 메모리에 상주시키지 않아 메모리 사용량을 최소화합니다.
- **`VaultManager`**: Vault 내의 모든 문서를 효율적으로 관리하며, 파일 시스템과 상호작용하여 문서의 생성, 수정, 삭제를 처리합니다.

## 주요 기능

- **고급 문서 탐색**: `vault` 도구를 통해 키워드 검색, 전체 목록 조회, 특정 문서 읽기, 통계 분석 등 다양한 탐색 기능을 제공합니다.
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

### `generate_property`

문서 경로(`filePath`)를 입력받아 해당 문서의 내용을 분석하고, AI가 추천하는 frontmatter 속성을 생성하여 반환합니다.

### `write_property`

파일 경로(`filePath`)와 JSON 형식의 속성(`properties`)을 입력받아, 해당 파일의 frontmatter를 업데이트합니다.

### `create_document_with_properties`

문서 분석, 속성 생성, 파일 업데이트의 전 과정을 한 번에 처리하는 통합 도구입니다.

### `organize_attachments`

키워드로 문서를 찾아 해당 문서에 연결된 모든 첨부 파일을 `images/{문서 제목}` 폴더로 이동시키고, 문서 내의 링크를 자동으로 업데이트합니다.

## 시작하기

1.  **저장소 복제 및 의존성 설치**:

    ```bash
    git clone https://github.com/sunub/obsidian-mcp-server.git
    cd obsidian-mcp-server
    npm install
    ```

2.  **환경 변수 설정**:
    프로젝트 루트에 `.env` 파일을 생성하고 Obsidian vault의 절대 경로를 지정합니다.

    ```
    VAULT_DIR_PATH=/path/to/your/obsidian/vault
    ```

3.  **프로젝트 빌드**:

    ```bash
    npm run build
    ```

4.  **서버 실행**:
    ```bash
    node build/index.js
    ```
    이제 MCP 클라이언트에서 서버에 연결하여 도구를 사용할 수 있습니다.

## 개발

### 테스트 실행

`vitest`를 사용하여 End-to-End 테스트를 실행할 수 있습니다.

```bash
npm test
```

### CI/CD

이 프로젝트는 GitHub Actions를 사용하여 CI/CD 파이프라인을 구축했습니다. `main` 브랜치에 push 또는 pull request가 발생하면 자동으로 빌드와 테스트가 수행됩니다.