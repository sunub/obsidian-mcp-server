# obsidian-mcp-server 도구 사용 가이드

이 문서는 현재 등록된 모든 top-level MCP 도구의 사용 의도를 한 번에 정리합니다.

핵심은 `vault`가 액션 라우터이고, 나머지 도구는 속도/재사용/안전성 중심으로 분리된 특수 기능입니다.

## 1. 도구 목록(등록 순서)

1. `vault`
2. `write_property`
3. `tidy_plan`, `plan_apply`, `plan_undo` (Vault 정리)

## 2. vault: 액션 기반 공용 인터페이스

`vault`는 내부적으로 `action` 하나를 받아 아래 4개 동작 중 하나를 실행합니다.

공통 입력 필드:
- `action` (필수): `search` | `read` | `list_all` | `stats`
- `compressionMode`: `aggressive` | `balanced` | `none`
- `maxOutputChars`: 출력 크기 제한(500~12000)
- `quiet`: true일 때 결과 축약 응답
- `includeContent`: `search`, `list_all` 응답 본문 여부(기본 true)
- `limit`: 기본값은 액션별 다름
- `excerptLength`: 검색 미리보기 길이
- `includeFrontmatter`: frontmatter 포함 여부

### 2.1 `search`

목적: 키워드와 의미 기반 검색을 결합한 후보 탐색.

요청 예시:

```json
{
  "action": "search",
  "keyword": "ES6",
  "limit": 5,
  "includeContent": true,
  "compressionMode": "balanced"
}
```

권장 쓰임:
- 1차 후보 확인
- Agent Context Pipeline에 넣을 문서/청크 후보 확인
- 개념 키워드 또는 의미적으로 가까운 문서가 맞는지 필터링

### 2.2 `read`

목적: 단일 파일의 본문/메타/백링크 조회.

요청 예시:

```json
{
  "action": "read",
  "filename": "Projects/ES6-notes.md",
  "compressionMode": "none"
}
```

권장 쓰임:
- `search` 후보를 확정해 세부 검증이 필요할 때
- 여러 노트를 종합하기 전에 원문 맥락 확인

### 2.3 `list_all`

목적: vault 전체 문서 목록/개요 조회.

요청 예시:

```json
{
  "action": "list_all",
  "limit": 50,
  "includeContent": false,
  "quiet": true
}
```

권장 쓰임:
- 대량 탐색 전 사전 지도를 만들 때
- 파일명 목록으로 `read` 대상 후보를 잡을 때

### 2.4 `stats`

목적: vault 통계(문서 수, 크기, 태그 히트맵 등) 조회.

요청 예시:

```json
{
  "action": "stats"
}
```

권장 쓰임:
- 파이프라인 실행 전 문서량 점검
- 인덱스 상태와 검색 성능 파악

## 3. write_property

목적: 실제 frontmatter 반영.

요청 예시:

```json
{
  "filePath": "notes/my-first-post.md",
  "properties": {
    "title": "ES6 요약",
    "tags": ["javascript", "es6"],
    "summary": "ES6 핵심 기능 정리",
    "slug": "es6-summary",
    "category": "study",
    "completed": true
  },
  "quiet": false
}
```

주의:
- `filePath`는 `VAULT_DIR_PATH` 내부여야 함
- 현재 기본 `quiet` 값은 `true`이므로 상세 응답이 필요하면 `false` 설정

## 4. 도구 조합 추천 패턴

### 패턴 A: 탐색-확인-요약
1) `vault/search`
2) 필요한 노트를 `vault/read`
3) Agent가 읽은 내용을 정리

### 패턴 B: 메타데이터 자동화
1) `vault/read`로 문서를 읽고 속성을 작성
2) `write_property`로 저장

## 5. 사용자 입장에서 꼭 알아야 할 기본 체크

- `VAULT_DIR_PATH`가 먼저 유효해야 모든 도구가 동작
- `vault`의 `action`은 필수이며 잘못된 값은 즉시 에러
- `quiet`를 많이 켜면 답변이 간결해져 후속 파싱이 쉬움
- 저장 동작(`write_property`)은 vault 외부 경로 쓰기를 차단
