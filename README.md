# Obsidian MCP Server

Obsidian MCP Server는 Obsidian vault의 문서들을 외부 애플리케이션이나 AI(LLM)에서 쉽게 읽고, 분석하고, 속성을 자동 생성·적용할 수 있도록 지원하는 서버입니다.

## 주요 기능

### 문서 읽기/검색/요약/통계

DocumentManager와 다양한 Tool을 통해 Obsidian vault 내의 마크다운 문서를 읽고, 키워드 기반 검색, 요약, 통계, 백링크 등 다양한 정보를 제공합니다.

### AI 기반 property(frontmatter) 자동 생성

generate_obsidian_properties 도구를 통해 문서 내용을 분석하여 title, tags, summary, slug 등 메타데이터를 자동으로 생성할 수 있습니다.

### frontmatter 기록 및 갱신

write_obsidian_property 도구를 통해 AI 또는 사용자가 생성한 property를 실제 파일의 frontmatter에 기록하거나 기존 값을 덮어쓸 수 있습니다.

### 통합 워크플로우 지원

create_document_with_properties 도구를 통해 문서 읽기 → property 생성 → frontmatter 기록까지 단일 호출로 자동화할 수 있습니다.

### 표준 입출력 기반 서버 실행

MCP 프로토콜을 준수하며, 다양한 클라이언트(예: gemini CLI, LLM, 외부 앱)와 연동 가능합니다.

## 주요 도구 목록

- obsidian_content_getter: 문서 검색, 읽기, 리스트, 통계 등 vault 내 컨텐츠 탐색
- generate_obsidian_properties: 문서 내용 기반 property 자동 생성
- write_obsidian_property: 생성된 property를 파일에 기록
- create_document_with_properties: 문서 읽기부터 property 생성·적용까지 통합 처리
