# 도구 호출 흐름 예시

이 문서는 사용자가 요청한 자연어가 MCP 도구 호출로 어떻게 변환되는지 보여줍니다.

## 1) `vault` 도구 기본 흐름

사용자가 말을 하면 모델은 `vault` 단일 tool을 호출하고 `action`으로 세부 동작을 선택합니다.

### 예시 1: 검색

자연어:

```text
Obsidian에서 "README.md의 시작하기 (빠른 설정)"과 관련된 "npx" 설정 예시만 찾아줘.
```

내부 호출:

```json
{
  "method": "tools/call",
  "params": {
    "name": "vault",
    "arguments": {
      "action": "search",
      "keyword": "README.md 시작하기 빠른설정 npx 설정",
      "limit": 5,
      "includeContent": true
    }
  }
}
```

### 예시 2: 노트 열람

자연어:

```text
docs/tool-reference.md의 `vault` 액션 설명 부분을 읽어줘.
```

내부 호출:

```json
{
  "method": "tools/call",
  "params": {
    "name": "vault",
    "arguments": {
      "action": "read",
      "filename": "tool-reference.md",
      "excerptLength": 1200
    }
  }
}
```

## 2) `vault` 이외 도구 호출

`write_property`는 `name`을 직접 지정해 호출합니다.

### 예시 3: frontmatter 적용

```json
{
  "method": "tools/call",
  "params": {
    "name": "write_property",
    "arguments": {
      "filePath": "my-first-post.md",
      "properties": {
        "title": "제목",
        "tags": ["obsidian", "mcp"],
        "summary": "간단 요약"
      },
      "quiet": false
    }
  }
}
```

## 3) 사용 시 참고

- `quiet` 기본값은 보수적으로 동작해 응답이 요약될 수 있습니다.
