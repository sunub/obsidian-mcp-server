# Tool Reference

이 문서는 실제 코드 기준으로 현재 동작하는 Obsidian MCP Server 도구를 정리합니다.

## 공통: Vault 및 경로 규칙

- Vault 인덱싱은 `.md`, `.mdx` 파일을 대상으로 합니다.
- `VAULT_DIR_PATH` 미설정 시 vault 도구/쓰기 도구가 실패합니다.
- Vault 내 상대경로/절대경로를 지원하며, 쓰기 작업은 Vault 경계 바깥을 차단합니다.
- Vault 경계 밖 쓰기는 `VaultPathError`로 처리됩니다.
- `read`의 `compressionMode` 기본값은 `summary`입니다.
- 잘못된 `action` 값은 가장 흔한 실패 원인입니다.

## 공통: `vault` 입력 파라미터

- `action` (필수): `search | read | list_all | stats`
- `quiet`, `compressionMode` (`read`, 기본값: `summary`)
- `maxOutputChars` (`read`)

`quiet: true`는 `search`, `list_all`에서 축약 응답을 반환합니다.

모든 `vault` 호출 기본 형태:

```json
{
  "action": "search",
  "keyword": "project"
}
```

## `vault` action

### `search`

키워드 검색과 의미 기반 검색을 결합한 하이브리드 후보 탐색을 수행합니다. 로컬 임베딩 모델이 준비되지 않은 경우 키워드 검색으로 폴백합니다.

- 필수: `keyword`
- 선택: `limit`(기본 10), `quiet`
- `compressionMode`, `maxOutputChars`, `includeContent`, `excerptLength`는 `search`에 영향을 주지 않습니다.
- 일치하는 문서를 `limit`건까지 순위 순서대로 모두 반환합니다. 응답 크기 때문에 문서를 빼지 않습니다.
- 각 문서는 `path`(Vault 기준 상대 경로), `title`, `tags`, `snippet`(최대 200자)을 담습니다. 본문에서 맞은 곳이 없으면 `snippet`이 없습니다.
- 본문은 `read`의 `filename`에 `path`를 넣어 읽습니다.

예시:

```json
{
  "action": "search",
  "keyword": "project",
  "limit": 5
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

## Frontmatter 기반 도구

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

## 실사용 포인트

- `vault` 액션은 단일 툴에 묶여 있으므로 `action` 문자열이 가장 자주 실패 원인입니다.
- 여러 노트를 종합할 때는 `search` 후 필요한 노트를 `read`합니다.
