# Obsidian MCP Server

`obsidian-mcp-server`는 [Model Context Protocol(MCP)](https://modelcontextprotocol.io/docs/getting-started/intro)을 구현한 서버로, 로컬 Obsidian vault의 문서들을 AI 에이전트나 외부 애플리케이션에서 쉽게 탐색하고 관리할 수 있도록 강력한 도구 API를 제공합니다.

## 주요 기능

- **고급 문서 관리**: `DocumentManager`를 통해 vault 내 모든 문서를 효율적으로 캐싱하고 관리합니다. gray-matter를 사용하여 frontmatter를 파싱하고 문서 내용을 빠르게 처리합니다.
- **다양한 문서 탐색**: 키워드 검색, 전체 목록 조회뿐만 아니라, 문서별 통계(단어, 줄, 글자 수), 백링크 및 아웃링크 분석, 공통 태그 기반 연관 문서 추천 등 다각적인 탐색 기능을 제공합니다.
- **AI 기반 속성 생성**: 문서 본문을 분석하여 `title`, `tags`, `summary`, `slug` 등 적절한 frontmatter 속성을 자동으로 생성합니다.
- **안전한 속성 업데이트**: 생성된 속성을 기존 frontmatter와 병합하여 파일에 안전하게 기록하거나 새로 쓸 수 있습니다.
- **통합 워크플로우**: 문서 분석부터 속성 생성, 파일 업데이트까지의 전체 과정을 단일 명령으로 실행하는 통합 워크플로우를 지원합니다.
- **신뢰성 및 테스트**: `vitest`를 사용한 End-to-End 테스트를 통해 서버의 안정성과 각 도구 API의 응답 스키마를 검증합니다.

## 도구 API

`obsidian-mcp-server`는 MCP 클라이언트를 통해 호출할 수 있는 다음과 같은 도구들을 제공합니다.

### `vault`

vault 내 문서를 탐색하고 분석하는 핵심 도구입니다. `action` 파라미터를 통해 다양한 기능을 수행할 수 있습니다.

- **`list_all`**: vault 내 모든 문서의 목록과 메타데이터, 전체 통계를 반환합니다.
- **`search`**: 키워드를 기반으로 문서 제목, 내용, 태그를 검색하고 일치하는 문서 목록을 제공합니다.
- **`read_specific`**: 특정 파일이나 디렉토리의 내용을 읽고, frontmatter와 본문을 반환합니다.
- **`stats`**: 문서의 단어 수, 줄 수, 문단 수 등 상세 통계를 제공합니다.
- **`backlinks`**: 특정 문서를 링크하고 있는 다른 문서(백링크) 목록을 찾아줍니다.

### `generate_property`

문서 경로(`filePath`)를 입력받아 해당 문서의 내용을 분석하고, AI가 추천하는 frontmatter 속성(JSON 형식)을 생성하여 반환합니다.

### `write_property`

파일 경로(`filePath`)와 JSON 형식의 속성(`properties`)을 입력받아, 해당 파일의 frontmatter를 업데이트합니다. 기존 속성은 유지되며 새로운 속성이 추가되거나 덮어쓰기됩니다.

### `create_document_with_properties`

문서 분석, 속성 생성, 파일 업데이트의 전 과정을 한 번에 처리하는 통합 도구입니다. 소스 파일 경로(`sourcePath`)만 지정하면 전체 워크플로우를 자동으로 실행합니다.

## 시작하기

1.  **저장소 복제 및 의존성 설치**:

    ```bash
    git clone https://github.com/your-repo/obsidian-mcp-server.git
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

`vitest`를 사용하여 End-to-End 테스트를 실행할 수 있습니다. 테스트는 실제 vault와 유사한 환경을 시뮬레이션하여 각 도구의 동작을 검증합니다.

```bash
npm test
```
