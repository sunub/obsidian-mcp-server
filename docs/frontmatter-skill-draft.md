# Frontmatter Skill 초안

3단계에서 블로그 글과 일반 노트 규칙을 나눌 때의 출발점이다.

`generate_property`와 `create_document_with_properties`는 디스크에 아무 일도 하지 않고 지시문만 돌려주는 도구였다. 도구에서는 뺐고, 담고 있던 지시문을 여기에 그대로 보존한다. 실제로 frontmatter를 쓰는 `write_property`는 도구로 남아 있다.

## 1. `generate_property`

### description

```text
Reads a target markdown document and returns an AI-facing payload for generating frontmatter properties.

This tool does not write to disk. It returns content_preview and a target output schema so an AI can produce a valid property object.

Use Cases:
- After completing a draft, when you need property suggestions from content.
- When missing frontmatter fields (title, tags, summary, slug, date, category, completed) should be generated.

To apply generated properties to a file, call 'write_property' with the resulting JSON.
```

### 입력

| 이름 | 타입 | 설명 |
|---|---|---|
| `filename` | string | 분석해 속성을 붙일 파일의 이름이나 경로 (예: `my-first-post.md`) |
| `overwrite` | boolean, 선택 | `true`면 기존 속성을 AI가 만든 내용으로 덮어쓴다 |

### 반환 payload

`content_preview`는 본문 앞 300자를 공백 한 칸으로 줄여 `...`을 붙인 값이다.

```json
{
  "filename": "<filename>",
  "content_preview": "<본문 앞 300자>...",
  "instructions": {
    "purpose": "Generate or update the document's frontmatter properties based on its content.",
    "usage": "Analyze the provided content_preview. If more detail is needed to generate accurate properties, you MUST call the 'vault' tool with action='read' to get the full document content.",
    "content_type": "markdown",
    "overwrite": false,
    "output_format": "Return a JSON object with the following structure",
    "schema": {
      "title": "string - Title representing the core topic",
      "tags": "string[] - Array of relevant tags from content keywords",
      "summary": "string - 1-2 sentence summary of the document",
      "slug": "string - URL-friendly hyphenated identifier",
      "date": "string - ISO 8601 date format",
      "completed": "boolean - Whether content is finalized",
      "aliases": "string[] - (Optional) Alternative names or synonyms",
      "category": "string - (Optional) Document category"
    }
  }
}
```

## 2. `create_document_with_properties`

### description

```text
Starts and completes a two-step workflow for AI-generated frontmatter properties.

Step 1: Call this tool with sourcePath (and optional outputPath). It returns a structured instruction payload and a content preview for AI analysis.
Step 2: Call this same tool again with aiGeneratedProperties. The tool then writes those properties by executing the same write logic used by the 'write_property' tool.

Use this tool when an AI agent should orchestrate analysis and write in a consistent workflow.
```

### 입력

| 이름 | 타입 | 설명 |
|---|---|---|
| `sourcePath` | string | 읽고 분석할 원본 마크다운 파일 경로 (예: `draft/my-article.md`) |
| `outputPath` | string, 선택 | 속성을 붙인 파일을 저장할 경로. 없으면 원본을 제자리에서 고친다 |
| `overwrite` | boolean, 기본 `false` | `true`면 기존 속성을 AI가 만든 내용으로 덮어쓴다 |
| `aiGeneratedProperties` | 속성 객체, 선택 | 2단계에서 AI가 만든 속성. 있으면 분석 없이 바로 쓴다 |
| `quiet` | boolean, 기본 `false` | `true`면 쓰기 결과를 최소한의 성공 메시지로 돌려준다 |

### 속성 스키마 (`aiGeneratedProperties`)

모든 필드는 선택이다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `title` | string | 문서 제목 |
| `tags` | string[] | 문서의 태그 목록 |
| `summary` | string | 문서의 짧은 요약 |
| `slug` | string | 문서의 URL용 식별자 |
| `date` | string | 문서 생성일, ISO 8601 |
| `category` | string | 문서의 분류 |
| `completed` | boolean | 작업이나 항목의 완료 여부 |
| `cssclasses` | string[] | 문서에 붙는 CSS 클래스 목록 |

### 2단계 흐름

1단계 호출은 `sourcePath`로 문서를 읽고 아래 payload를 돌려준다. `content_preview`는 본문 앞 2000자이고, 더 길면 `...`을 붙인다.

```json
{
  "ai_prompt": "Your task is to analyze the provided text content and create a JSON object of document properties based on the requested schema. After creating the JSON object, you MUST call the 'create_document_with_properties' tool again, passing back the original parameters along with the new 'aiGeneratedProperties' parameter containing your generated JSON.",
  "purpose": "Analyze document content and return a structured JSON object of properties.",
  "content_to_analyze": {
    "source_path": "<sourcePath>",
    "content_preview": "<본문 앞 2000자>"
  },
  "next_action_required": {
    "tool_to_call": "create_document_with_properties",
    "parameters_to_add": {
      "sourcePath": "<sourcePath>",
      "outputPath": "<outputPath>",
      "overwrite": "<overwrite>",
      "quiet": "<quiet>",
      "aiGeneratedProperties": "<- Insert your generated JSON object here."
    },
    "example_of_next_call": {
      "tool_name": "create_document_with_properties",
      "parameters": {
        "sourcePath": "<sourcePath>",
        "aiGeneratedProperties": {
          "title": "Serverless 환경에서 I/O 처리 최적화 경험기",
          "date": "2025-04-03",
          "tags": ["serverless", "optimization"],
          "summary": "Promise.all, Worker를 벤치마크하며 서버리스 환경에서의 I/O 처리 최적화 경험기를 공유합니다.",
          "slug": "serverless-io-optimization",
          "category": "code",
          "completed": true
        }
      }
    }
  }
}
```

2단계 호출은 `aiGeneratedProperties`를 받아 `outputPath`(없으면 `sourcePath`)에 `write_property`와 같은 쓰기 로직으로 저장한다.
