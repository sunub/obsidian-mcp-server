# CLI AI Agent UI

<img width="2020" height="744" alt="banner" src="https://github.com/user-attachments/assets/16337be2-f728-4761-b8d8-b1ec7425e2e4" />


`src/cli`는 `obsidian-mcp-server` 프로젝트의 터미널 기반 AI 에이전트 인터페이스입니다.

이 CLI의 목적은 Obsidian Vault를 단순히 검색하는 수준을 넘어서, **MCP 도구 호출**, **조건부 RAG 기반 문맥 수집**, **OpenAI 호환 LLM endpoint 스트리밍 응답**을 하나의 대화형 작업 흐름으로 묶는 데 있습니다. 즉, 이 디렉터리는 "채팅 UI"만 구현하는 곳이 아니라, Vault와 도구, 모델 사이를 연결하는 **오케스트레이션 레이어**입니다.

## 왜 이 CLI가 필요한가

프로젝트의 문서와 설계 방향을 기준으로 보면, 이 CLI는 다음 문제
를 해결하거나 완화하기 위해 만들어졌습니다.

- **외부 AI 서비스 의존성 감소**
  - 프로젝트가 로컬 Vault와 로컬 도구를 다루는 만큼, 가능한 한 로컬 실행 환경에서 독립적으로 동작하도록 지향합니다.
- **문맥 손실 감소**
  - Vault 관련 도구가 트리거된 질문에서는 관련 문서를 수집하고 요약해 LLM에 함께 전달할 수 있습니다.
- **토큰 낭비 감소**
  - `collect_context` 기반 압축 요약과 대량 입력 오프로딩을 통해 긴 문서나 대형 paste를 그대로 모델에 밀어넣지 않습니다.
- **터미널 입력 안정성 개선**
  - Raw mode 기반 입력 환경에서 발생하는 paste storm, 다중 Enter 트리거, 버퍼 오염 같은 문제를 제어합니다.
- **장시간 세션 안정성 확보**
  - 스트리밍 취소, 히스토리 pruning, scrollback 위임 같은 구조를 통해 메모리 사용량과 렌더링 부담을 줄입니다.

## 이 CLI가 하는 일

### 1. 대화형 AI 인터페이스

사용자는 터미널에서 자연어로 질문을 입력하고, CLI는 LLM 서버와 통신해 답변을 스트리밍합니다.

- 응답을 실시간으로 출력합니다.
- 모델의 thinking 영역이 있으면 중간 추론 상태도 별도로 렌더링합니다.
- 완료된 대화는 히스토리에 반영하고, 진행 중 응답은 별도 `pending` 상태로 관리합니다.

### 2. MCP 도구 실행 인터페이스

CLI는 MCP 서버에 연결된 도구를 터미널에서 직접 사용할 수 있게 합니다.

- `/search`, `/read`, `/stats`, `/context`, `/tools` 같은 슬래시 커맨드를 제공합니다.
- 사용자의 명시적 명령뿐 아니라, LLM이 tool call을 생성했을 때도 이를 실행할 수 있는 루프를 제공합니다.
- 여러 MCP 서버에 연결하고, 각 서버의 도구 목록과 연결 상태를 함께 관리합니다.

### 3. 조건부 RAG 기반 문맥 주입

이 CLI는 모든 일반 질문에 대해 자동으로 RAG를 수행하지는 않습니다. 현재 구현 기준으로는 입력 텍스트에서 `vault` 도구나 관련 서버/도구 이름이 트리거된 경우에만 Vault 문맥 수집을 시도하고, 이를 `<context>` 블록으로 정리해 프롬프트에 주입합니다.

- `collect_context` 액션을 활용해 관련 문서를 배치 단위로 수집합니다.
- `memory_packet`과 고연관 문서 excerpt를 조합해 LLM 입력을 구성합니다.
- 따라서 이 CLI는 항상 RAG가 붙는 채팅창이라기보다, **필요 시 Vault-aware 동작을 수행하는 agent UI**에 가깝습니다.

### 4. 대용량 입력 최적화

긴 코드, 로그, 문서가 붙여넣기되면 이를 그대로 모델에 보내는 대신 안전하게 축약/오프로딩합니다.

- 큰 paste는 임시 파일로 분리해 저장합니다.
- LLM에는 전체 본문 대신 파일 위치와 미리보기, 처리 지시문을 전달합니다.
- 이 방식은 토큰 사용량을 줄이고, 필요할 때만 도구를 통해 원문을 읽게 만듭니다.

### 5. 스트리밍 중심 사용자 경험

CLI UI는 응답이 끝난 뒤 한 번에 보여주는 구조가 아니라, 생성 중인 상태를 즉시 보여주는 흐름을 중심으로 설계되어 있습니다.

- 입력 직후 버퍼를 비워 다음 작업을 준비합니다.
- 첫 토큰 전에는 thinking/processing 상태를 보여줍니다.
- 완료된 기록은 정적 영역으로 넘기고, 현재 응답만 동적으로 다시 렌더링합니다.

## 주요 실행 흐름

문서와 현재 구현을 기준으로 한 기본 흐름은 다음과 같습니다.

1. 사용자가 메시지 또는 슬래시 커맨드를 입력합니다.
2. 질문 내용에서 Vault 관련 도구가 트리거되면 관련 문맥 수집을 시도합니다.
3. LLM 스트리밍 요청을 시작합니다.
4. 필요 시 MCP 도구를 호출합니다.
5. 응답을 실시간으로 출력합니다.
6. 완료된 결과를 히스토리에 반영하고 다음 입력을 기다립니다.

## 아키텍처 관점에서의 역할

`src/cli`는 크게 다음 역할로 나뉩니다.

| 영역 | 역할 | 대표 파일 |
| --- | --- | --- |
| 부팅 및 환경 확인 | LLM endpoint 확인, 초기 로더/에러 화면 제어 | `AppContainer.tsx`, `ui/LLMHealthChecker.tsx`, `ui/LLMStatusLoader.tsx` |
| MCP 연결 관리 | 설정 파일 기반 MCP 서버 연결, 도구 목록 수집, 멀티 서버 상태 관리 | `hooks/useMcpManager.ts`, `services/McpClientService.ts`, `config/mcpServersConfig.ts` |
| 입력 시스템 | Raw key 처리, paste 버퍼링, 멀티라인 편집, 히스토리 탐색 | `context/KeypressContext.tsx`, `ui/InputPrompt.tsx`, `key/` |
| 명령 디스패치 | 슬래시 커맨드를 MCP 도구 호출로 변환 | `hooks/useDispatcher.ts` |
| RAG 컨텍스트 수집 | Vault 관련 도구가 트리거된 질문에서만 문맥을 수집해 프롬프트에 주입 | `hooks/useRagContext.ts` |
| LLM 스트리밍 루프 | 스트리밍 응답, tool call 실행, thinking 파싱 | `hooks/useLlmStream/useLlmStream.ts` |
| 렌더링 및 세션 관리 | 히스토리 출력, pending 응답 표시, transient UI 메시지 관리 | `ui/MainContent.tsx`, `hooks/useHistoryManager.ts` |
| 대량 입력 최적화 | 큰 붙여넣기 입력 오프로딩 및 임시 파일 정리 | `services/InputOffloadService.ts` |

## 설계 원칙

이 CLI는 다음 원칙을 중심으로 설계됩니다.

- **입력과 렌더링의 분리**
- **스트리밍 우선 UX**
- **설정 파일 기반 MCP 연결**
- **도구 호출과 대화 흐름의 통합**
- **토큰/메모리 효율 최적화**
- **중단 가능성과 복구 가능성 보장**

## 제공하는 주요 명령

현재 코드 기준으로 기본 제공되는 대표 슬래시 커맨드는 다음과 같습니다.

- `/search <keyword>`: Vault 검색
- `/read "filename"`: 특정 문서 열람
- `/semantic <query>`: 시맨틱 검색
- `/stats`: Vault 상태 확인
- `/index`: 벡터 인덱스 갱신
- `/context <topic>`: 토픽 기반 문맥 수집
- `/organize <keyword>`: 첨부 정리 도구 실행
- `/genprop <filename>`: frontmatter 생성 도구 호출
- `/tools`: 연결된 MCP 도구 목록 확인
- `/help`: 도움말 표시
- `/clear`: 화면/대화 상태 초기화

## 실행 방법

현재 이 디렉터리의 CLI 진입점은 **저장소 개발 환경용 실행 방식**입니다. `package.json` 기준으로 CLI UI는 별도 배포 bin이 아니라 다음 스크립트로 실행됩니다.

```bash
npm run cli
```

이 스크립트는 `src/cli/index.tsx`를 직접 실행합니다. 패키지의 `bin` 엔트리는 MCP 서버(`build/index.js`)용이며, 이 README의 CLI UI 실행 방식과는 별개입니다.

### MCP 설정 파일

CLI는 실행 시 현재 작업 디렉터리에서 다음 파일을 순서대로 찾습니다.

1. `mcp-servers.json`
2. `.mcp-servers.json`

이 저장소 루트에는 기본 `mcp-servers.json`이 포함되어 있으며, 현재 기본 설정은 `obsidian` MCP 서버를 다음처럼 `node ./build/index.js`로 연결합니다.

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["./build/index.js"]
    }
  }
}
```

따라서 가장 안전한 실행 방식은 **저장소 루트에서**, `build/index.js`가 준비된 상태로, 아래처럼 필요한 환경 변수를 주고 실행하는 것입니다.

### 환경 변수 예시

```bash
VAULT_DIR_PATH="/path/to/vault" \
LLM_API_URL="http://127.0.0.1:8080" \
LLM_CHAT_MODEL="llama3" \
npm run cli
```

### 실행 시 주의할 점

- 이 README의 실행 방법은 **개발용 CLI UI 진입점** 기준입니다.
- CLI가 MCP 서버에 연결되려면 현재 디렉터리의 `mcp-servers.json` 또는 `.mcp-servers.json`이 유효해야 합니다.
- 설정 파일이 없으면 환경 변수 기반 fallback을 시도하지만, 현재 코드 기준으로는 저장소의 기본 설정 파일을 사용하는 경로가 더 명확합니다.
