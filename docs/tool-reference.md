# Tool Reference

이 문서는 실제 코드 기준으로 현재 동작하는 Obsidian MCP Server 도구를 정리합니다.

## 공통: Vault 및 경로 규칙

- Vault 인덱싱은 `.md`, `.mdx` 파일을 대상으로 합니다.
- `VAULT_DIR_PATH` 미설정 시 vault 도구/쓰기 도구가 실패합니다.
- Vault 내 상대경로/절대경로를 지원하며, 쓰기 작업은 Vault 경계 바깥을 차단합니다.
- Vault 경계 밖 쓰기는 `VaultPathError`로 처리됩니다.
- `vault` 액션은 `compressionMode` 기본값이 `balanced`입니다.
- 잘못된 `action` 값은 가장 흔한 실패 원인입니다.

## 공통: `vault` 입력 파라미터

- `action` (필수): `search | read | list_all | stats | collect_context | load_memory`
- `quiet` (기본값: `true`), `compressionMode` (기본값: `balanced`)
- `maxOutputChars` (기본값: 액션별 상한)

`quiet: true`는 `search`, `list_all`, `load_memory`에서 축약 응답을 반환합니다.

모든 `vault` 호출 기본 형태:

```json
{
  "action": "search",
  "keyword": "project"
}
```

## `vault` action

### `search`

인덱스 기반 검색(AND 토큰)을 수행합니다.

- 필수: `keyword`
- 선택: `includeContent`(기본 `true`), `includeFrontmatter`(기본 `false`, 현재 응답에서 실질 반영은 없음), `limit`, `excerptLength`
- 기본 제약:
  - `balanced`: `limit=5`, `excerptLength=500`
  - `aggressive`: `limit=3`, `excerptLength=220`
  - `none`: 전체 매치, 제한 없음
- `quiet: true`면 `{ found, filenames }` 축약 응답
- 기본 응답: `{ query, found, matched_total, total_in_vault, documents, compression }`
- 각 문서 `documents[i].content`는 `includeContent=true`일 때 `full`, `excerpt`가 포함되고, false일 때 `preview`/`note`로 반환됩니다.

예시:

```json
{
  "action": "search",
  "keyword": "project",
  "limit": 5,
  "includeContent": true,
  "excerptLength": 260,
  "compressionMode": "balanced"
}
```

### `read`

단일 문서 조회입니다. 파일명은 제목/경로/절대경로를 처리합니다.

- 필수: `filename`
- 선택: `excerptLength`
  - 기본값은 `compressionMode`별:
    - `balanced`: 2500
    - `aggressive`: 1200
    - `none`: 무제한
- `compressionMode=none`일 때는 백링크 제한이 없습니다.
- 기본 응답에는 `filePath`, `frontmatter`, `stats`, `content`, `backlinks`, `contentLength`, `compression`이 포함됩니다.

예시:

```json
{
  "action": "read",
  "filename": "meeting-notes.md",
  "excerptLength": 1800,
  "compressionMode": "balanced"
}
```

### `list_all`

Vault 문서 목록을 반환합니다.

- 선택: `limit`(기본 50), `includeContent`(기본 `true`), `quiet`
- `includeContent=true`면 미리보기/메타 확장
- `quiet: true`면 `{ total_documents, filenames }`
- 기본 응답: `{ vault_overview, documents }`

예시:

```json
{
  "action": "list_all",
  "limit": 20,
  "includeContent": false
}
```

### `stats`

- Vault 상태 메타 (`totalFiles`, `isInitialized`, `vaultPath`)를 반환합니다.
- `action`만 지정하면 충분합니다.

예시:

```json
{
  "action": "stats"
}
```

### `collect_context`

주제/전체 범위에서 문서를 추려 장기 메모리 패킷을 생성합니다.

- 필수: `scope=topic`이면 `topic`
- 선택: `topic`, `maxDocs`(기본 20), `maxCharsPerDoc`(기본 1800), `memoryMode`, `continuationToken`, `scope`
- `memoryMode`: `response_only | vault_note | both` (기본 `response_only`)
- 배치 처리로 `batch.continuation_token`을 반환해 이어 호출 가능
- 토큰은 `base64url` 인코딩 형식
- 기본적으로 최근 조회 결과를 캐시하며(최대 200개), `cache`에 키/해시/히트 여부를 포함
- `memoryMode`가 `vault_note|both`면 `memory/context_memory_snapshot.v1.md`에 Canonical JSON 블록 포함 노트 저장 시도

주요 응답 필드:
- `action`, `scope`, `topic`, `matched_total`, `total_in_vault`
- `documents`, `memory_packet`, `memory_mode`, `memory_write`
- `batch` (`has_more`, `continuation_token` 포함)
- `compression`

예시:

```json
{
  "action": "collect_context",
  "scope": "topic",
  "topic": "next.js",
  "maxDocs": 12,
  "maxCharsPerDoc": 900,
  "memoryMode": "both",
  "compressionMode": "balanced"
}
```

배치 이어 호출:

```json
{
  "action": "collect_context",
  "continuationToken": "<batch.continuation_token>"
}
```

### `load_memory`

`memory/context_memory_snapshot.v1.md`(또는 `memoryPath`)를 읽어 canonical JSON을 파싱합니다.

- 선택: `memoryPath`, `quiet`, `includeContent`, `excerptLength`
- 기본 응답:
  - `action`, `found`, `memory_path`, `has_canonical_json`
  - `schema_version`, `topic`, `scope`, `documents_count`, `memory_packet`, `preview`, `compression`
- `quiet: true`면 요약 메타만 반환

예시:

```json
{
  "action": "load_memory",
  "excerptLength": 800,
  "quiet": false
}
```

## Frontmatter 기반 도구

### `generate_property`

- 파일 프리뷰(최대 300자)와 추천 frontmatter 스키마를 반환합니다.
- 입력: `filename`(필수), `overwrite`(선택)
- 실제 쓰기 전 단계에서 사용합니다.
- 출력 예시 스키마에는 `aliases`가 포함될 수 있습니다.
- 보통 `write_property` 전 단계로 사용합니다.

예시:

```json
{
  "filename": "my-first-post.md",
  "overwrite": false
}
```

### `write_property`

- 파일 frontmatter를 즉시 갱신/추가합니다.
- 입력: `filePath`, `properties`, `quiet`(기본 `true`)
- 동작:
  - `vault` 경로를 벗어난 쓰기는 `VaultPathError`.
  - 성공 시 `status`/`message`(quiet false)/`properties` 응답.
  - quiet true이면 최소 응답 `{"status":"success"}`

예시:

```json
{
  "filePath": "my-first-post.md",
  "properties": {
    "title": "제목",
    "tags": ["obsidian", "mcp"],
    "summary": "요약"
  },
  "quiet": false
}
```

### `create_document_with_properties`

2단계 워크플로우입니다.

- 1단계: `sourcePath` 입력 시 `content_to_analyze`(2000자 미리보기), `ai_prompt`, `next_action_required` 반환
- 2단계: `aiGeneratedProperties`를 넣어 동일 tool 재호출하면 저장 수행
- 저장 대상: `outputPath`가 있으면 그 경로, 없으면 `sourcePath`

예시:

```json
{
  "sourcePath": "my-first-post.md",
  "outputPath": "my-first-post.md",
  "overwrite": false
}
```

2단계:

```json
{
  "sourcePath": "my-first-post.md",
  "aiGeneratedProperties": {
    "title": "제목",
    "summary": "수정 요약"
  },
  "overwrite": true
}
```

### `organize_attachments`

- 키워드로 문서를 검색한 뒤 이미지 링크를 Vault 내 폴더로 이동하고 링크를 갱신합니다.
- 현재 구현은 기본적으로 `images/<문서 제목>/` 하위로 이동합니다. (`destination`, `useTitleAsFolderName`은 스키마에는 있으나 완전 반영 제한)
- 입력: `keyword`, `destination`, `useTitleAsFolderName`, `quiet`
- 출력:
  - `summary`
  - `details[]`: `document`, `status`, `targetDirectory`, `movedFiles`, `errors`
  - `status` 값은 `success`, `skipped` 중심(요약 시 0개 이동 시 `skipped`)

예시:

```json
{
  "keyword": "my-first-post",
  "quiet": false
}
```

## 실사용 포인트

- `vault` 액션은 단일 툴에 묶여 있으므로 `action` 문자열이 가장 자주 실패 원인입니다.
- `collect_context`는 큰 vault에서 `maxDocs`를 작게 시작해 배치로 확장하는 게 비용 효율적입니다.
- `load_memory`는 canonical JSON이 유효할 때만 `memory_packet`을 반영합니다.
