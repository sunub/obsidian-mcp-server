# Obsidian Agent Product — New Project Handoff

> 이 문서가 다루는 에이전트 CLI는 별도 프로젝트 `cli-agent`(`/Users/sunub/workspace/cli-agent`)로 분리되었다. 이 저장소에는 MCP 서버와 Claude Code 플러그인만 남는다.

## 1. 이 문서의 목적

이 문서는 기존 `obsidian-mcp-server` 저장소에서 논의한 제품 전환 결정을 새 프로젝트와 새 세션으로 옮기기 위한 self-contained handoff다. 새 세션은 이전 대화에 접근할 수 없다고 가정하며, 이 문서만으로 제품 목표, 확정된 결정, MVP 범위, 기술 경계, 기존 코드에서 가져올 것과 버릴 것, 첫 작업 순서를 이해할 수 있어야 한다.

## 2. 한 문장 제품 정의

**Obsidian 안에서 현재 노트와 Vault 근거를 사용해 출처가 명확한 답변을 생성하고, 사용자의 승인을 거쳐 노트에 반영하는 desktop-only, local-first AI workspace.**

초기 사용자 경험의 canonical name은 **Vault Copilot**이다.

## 3. 전환 배경

기존 프로젝트는 로컬 우선 Obsidian MCP 서버와 개발용 Ink CLI를 함께 포함했다. CLI는 local LLM, MCP tool calling, Vault retrieval, streaming UI를 연결했지만 다음 문제가 드러났다.

- CLI가 실제 사용자 제품이 아니라 개발용 진입점에 머물렀다.
- 사용자는 Vault를 다루면서도 Obsidian 밖의 터미널로 이동해야 했다.
- Obsidian이 이미 제공하는 현재 노트, 선택 영역, 링크, 속성, workspace 상태를 활용하지 못했다.
- RAG context를 선취득한 뒤 같은 turn에서 vault tool을 다시 호출하는 중복 orchestration이 있었다.
- tool result가 누적되며 `9,646 prompt tokens > 8,192 context window`가 되어 pre-stream HTTP 400으로 종료됐다.
- Ink `<Static>` history와 pending 상태의 계약이 깨져 assistant 본문과 tool progress가 중복 출력됐다.
- MCP server lifecycle, stdio transport, terminal input/rendering이 제품 가치보다 큰 복잡성을 만들었다.

결론은 기존 CLI를 더 큰 범용 agent로 키우는 대신, 사용자가 실제로 작업하는 Obsidian 안에 제품을 두는 것이다.

## 4. 확정된 제품 결정

### 4.1 제품 표면

- Obsidian이 유일한 사용자-facing 제품 표면이다.
- MCP server는 새 제품의 architecture requirement가 아니다.
- 외부 MCP client 호환성은 초기 범위에서 제거한다.
- 기존 CLI는 사용자 제품이 아니라 개발·회귀 테스트·진단 harness로만 참고한다.

### 4.2 플랫폼

- 초기 제품은 **desktop-only Obsidian plugin**이다.
- 모바일 호환성은 초기 요구사항이 아니다.

### 4.3 런타임 경계

- Agent Harness는 초기에는 Obsidian plugin 내부에서 실행한다.
- 제품 전용 companion/daemon process는 만들지 않는다.
- 실제 local LLM은 Ollama, llama.cpp, LM Studio 등 별도 local provider가 실행하고 plugin은 localhost API로 호출한다.
- indexing·chunking 같은 무거운 작업은 UI thread를 막지 않도록 bounded background worker에서 실행한다.
- measured stability/performance 문제로 필요성이 증명되기 전에는 companion process를 추가하지 않는다.

### 4.4 모델 정책

- local LLM이 기본값이다.
- 외부 model provider는 사용자가 명시적으로 설정하고 선택한 경우에만 사용한다.
- provider 선택은 Agent Harness의 adapter 경계 뒤에 둔다.
- 특정 provider SDK가 제품 domain을 지배하지 않게 한다.

### 4.5 네트워크 정책

- Vault 처리와 기본 model 실행은 local-first다.
- 웹 검색과 외부 API tool은 기본 비활성이다.
- 네트워크 tool은 사용자가 명시적으로 활성화하고 실행 시점에 인지할 수 있어야 한다.
- Vault 원문을 외부 provider나 web tool로 전송하는 행위는 별도 권한 경계로 다룬다.

## 5. Canonical Language

### Vault Context Layer

AI가 장기 작업 context로 사용할 수 있도록 Vault 자료를 검색하고 압축해 제공하는 Obsidian Vault의 역할이다.

### Agent Context Pipeline

Vault 자료를 검색하고, 관련 근거를 선택하고, context window에 맞게 압축하고, 모델의 working context로 제공하는 전체 흐름이다.

### Context Compression

선택된 Vault 자료를 출처와 근거를 보존한 작은 context packet으로 바꾸는 행위다. 단순 요약이나 임의 앞부분 절단과 다르다.

### Agent Harness

모델 선택, tool 접근, context budget, 권한, 취소, 재시도, 실행 제한, observable run state를 통제하는 agent 실행 환경이다. 모델이나 LangChain 자체를 뜻하지 않는다.

### Local-First Execution

model 실행, Vault retrieval, context 준비는 local provider를 기본으로 사용하고, 외부 provider와 network tool은 명시적 사용자 선택이 있을 때만 사용하는 정책이다.

### Vault Copilot

현재 노트와 선택된 Vault evidence를 사용해 답변을 생성하고 출처를 보여주며, 사용자 승인 후에만 결과를 현재 노트에 삽입하는 초기 제품 경험이다.

## 6. MVP 범위

### 6.1 핵심 사용자 흐름

```text
현재 노트 또는 선택 영역에서 질문
    ↓
현재 노트와 필요한 Vault 문서만 context로 선택
    ↓
local LLM이 근거가 연결된 답변 생성
    ↓
사용한 노트·제목·문단 출처 표시
    ↓
사용자가 preview/diff 검토
    ↓
승인한 경우에만 현재 노트에 삽입
```

### 6.2 MVP에 포함

- Obsidian 우측 side panel
- 현재 active note와 selection 인식
- local OpenAI-compatible/Ollama-style provider 설정
- streaming answer와 취소
- read-only `search_vault` tool
- read-only `read_note` tool
- evidence selection과 source citation
- request context budget
- tool 실행 trace와 현재 상태 표시
- 오류 복구 후 입력 재활성화
- 결과 preview/diff
- 사용자 승인 후 현재 노트 삽입

### 6.3 MVP에서 제외

- 웹 검색
- 외부 LLM provider UI
- 다중 agent
- 자율적인 연속 note 수정
- background autonomous jobs
- attachment/frontmatter 자동화
- 장기 agent memory
- 모바일 지원
- 제품 전용 companion process
- LangChain의 고수준 AgentExecutor에 대한 필수 의존

## 7. Agent Harness 책임

### Model Provider

- provider-independent streaming interface
- local provider health check
- abort/timeout
- finish reason 보존
- context window와 output reserve 관리
- provider error를 typed outcome으로 변환

### Tool Registry

- tool name, input schema, output schema
- read/write/network capability 표시
- 사용자 승인 정책
- timeout과 cancellation
- 결과 크기와 evidence budget
- canonical tool trace

### Run State

- idle
- preparing_context
- waiting_for_model
- streaming
- waiting_for_tool_approval
- executing_tool
- preparing_answer
- complete
- incomplete
- cancelled
- failed

UI loading 상태와 terminal outcome은 분리한다. 실패·취소·불완전 결과는 입력을 영구 잠그지 않는다.

### Context Budget

매 model 요청 전에 다음 전체를 계산한다.

- system instructions
- current note/selection
- selected Vault evidence
- recent conversation
- tool schemas
- tool-call arguments/results
- output token reserve
- safety margin

한 번의 tool result cap이 아니라 turn 전체 evidence budget을 사용한다. canonical execution trace와 model에 보내는 compacted request view를 분리한다.

### Permission Boundary

- Vault read: 기본 허용
- 현재 note insert: 항상 preview 후 승인
- 여러 파일 수정: MVP 제외
- network access: 명시적 opt-in
- Vault content를 external provider로 전송: 별도 명시적 동의

## 8. LangChain 사용 원칙

LangChain은 제품 architecture가 아니라 선택 가능한 implementation library다.

사용할 수 있는 영역:

- model adapter
- streaming runnable composition
- tool schema adapter
- text splitting
- provider integration

제품이 직접 소유해야 하는 영역:

- Agent Harness state machine
- context budgeting
- permission policy
- Obsidian lifecycle
- tool result provenance
- run trace
- note diff/apply policy
- failure recovery

초기에는 작은 명시적 state machine을 권장한다. LangChain AgentExecutor가 제품 정책을 암묵적으로 결정하게 하지 않는다.

## 9. 첫 번째 Tool Set

### search_vault

입력:

- query
- limit
- optional path scope

출력:

- source path
- title
- heading
- evidence snippet
- relevance
- truncation metadata

### read_note

입력:

- Vault-relative path
- optional heading/block/range
- max evidence budget

출력:

- requested excerpt
- source reference
- range metadata
- hasMore/continuation metadata

### insert_into_current_note

MVP에서 모델이 직접 실행하는 write tool로 만들지 않는다. Agent Harness가 생성 결과를 diff proposal로 변환하고, 사용자가 승인한 경우에만 Obsidian editor API를 호출한다.

## 10. Retrieval 전략

초기에는 가볍게 시작한다.

1. 현재 note와 selection을 최우선 evidence로 사용
2. Obsidian metadata cache와 Vault API 기반 lexical/path/link retrieval
3. source/path/heading을 보존한 context packet 생성
4. 중복 evidence 제거
5. context budget 안에서 상위 evidence만 모델에 전달

semantic embedding, vector database, local reranker는 MVP 이후에 추가한다. 기존 LanceDB와 Transformers를 플러그인에 그대로 번들하지 않는다. lexical retrieval의 실제 품질이 부족하다는 측정 결과가 있을 때 browser/plugin 친화적 backend를 선택한다.

## 11. UI 방향

### 기본 레이아웃

- 상단: 현재 context 범위(현재 note, selection, Vault)
- 중앙: 대화와 streaming response
- Tool activity: 실행 중 tool, 성공/실패, 사용한 evidence 수
- Sources: 클릭 가능한 note/heading 목록
- 하단: prompt input, stop button
- Answer action: Copy, Preview Insert, Discard

### 핵심 UX 원칙

- tool trace와 assistant answer를 섞지 않는다.
- 이미 확정된 텍스트와 streaming pending tail을 분리한다.
- source가 없는 주장은 source가 있는 것처럼 표시하지 않는다.
- context가 잘렸다면 숨기지 않고 범위를 보여준다.
- 실패 후에도 입력할 수 있다.
- write는 항상 preview/diff 후 승인한다.

## 12. 기존 프로젝트에서 재사용할 것

코드를 그대로 복사하기보다 domain behavior와 검증된 순수 로직을 옮긴다.

재사용 후보:

- Agent Context Pipeline의 용어와 원칙
- `collect_context`의 evidence packet 구조
- source refs, evidence snippets, truncation metadata
- hybrid retrieval과 reranking에서 배운 ranking 기준
- local provider HTTP 통신 패턴
- cancellation/timeout/retry 원칙
- context budget 및 400 recovery 계획
- streaming accumulator의 committed/pending invariant
- local model lazy lifecycle에서 배운 resource bound 원칙

참고 경로:

- `CONTEXT.md`
- `docs/adr/0001-agent-context-pipeline-over-search-backend.md`
- `docs/adr/0002-obsidian-native-product-boundary.md`
- `.omx/plans/cli-streaming-output-integrity.md`
- `src/tools/vault/utils/actions/collect_context.ts`
- `src/tools/vault/utils/shared.ts`
- `src/cli/hooks/useRagContext.ts`
- `src/cli/hooks/useLlmStream/`
- `src/utils/LocalModelManager.ts`

## 13. 그대로 가져오지 않을 것

- MCP server와 stdio transport
- MCP tool registration layer
- Ink terminal UI
- raw terminal input/key handling
- CLI history rendering
- filesystem path를 전역 설정으로 사용하는 VaultManager
- chokidar 기반 Vault watcher
- 현재의 global singleton lifecycle
- LanceDB native binding을 전제로 한 storage layer
- 현재의 반복 agent loop와 누적 `progressLog`
- 문자 수 기반 `truncateHistory(..., 6000)`
- tool result의 무표식 `.slice(0, 8000)`
- RAG prefetch와 agentic Vault search를 한 turn에서 동시에 사용하는 흐름

## 14. 새 프로젝트 권장 구조

```text
/
├── manifest.json
├── versions.json
├── styles.css
├── package.json
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-obsidian-native-product-boundary.md
│       └── 0002-plugin-contained-agent-harness.md
├── src/
│   ├── main.ts
│   ├── plugin/
│   │   ├── lifecycle.ts
│   │   ├── settings.ts
│   │   └── commands.ts
│   ├── ui/
│   │   ├── CopilotView.ts
│   │   ├── ConversationView.ts
│   │   ├── SourcesView.ts
│   │   └── InsertPreview.ts
│   ├── agent/
│   │   ├── AgentHarness.ts
│   │   ├── RunState.ts
│   │   ├── ContextBudget.ts
│   │   └── ExecutionTrace.ts
│   ├── providers/
│   │   ├── ModelProvider.ts
│   │   └── LocalOpenAIProvider.ts
│   ├── context/
│   │   ├── ContextPipeline.ts
│   │   ├── EvidenceSelector.ts
│   │   └── ContextPacket.ts
│   ├── tools/
│   │   ├── Tool.ts
│   │   └── vault/
│   │       ├── SearchVaultTool.ts
│   │       └── ReadNoteTool.ts
│   └── obsidian/
│       ├── VaultAdapter.ts
│       ├── WorkspaceContext.ts
│       └── NoteMutation.ts
└── tests/
    ├── unit/
    ├── integration/
    └── fixtures/
```

파일명은 초기 가이드이며 구현 과정에서 단순화할 수 있다. domain boundary는 유지한다.

## 15. 단계별 로드맵

### Phase 0 — Product skeleton

- Obsidian sample plugin 기반 프로젝트 생성
- side panel 등록
- settings tab
- local provider 연결 상태 확인
- current note/selection 표시
- Agent Harness 최소 state machine

### Phase 1 — Read-only Vault Copilot

- `search_vault`
- `read_note`
- context packet
- request budget
- streaming/cancel/error recovery
- sources panel
- 동일 질문 deterministic integration fixture

### Phase 2 — Approved note insertion

- answer preview
- text diff
- target cursor/range 표시
- explicit approve/discard
- undo-compatible editor mutation

### Phase 3 — Retrieval quality

- backlinks/outlinks 활용
- heading/block-aware retrieval
- lexical retrieval evaluation
- 필요성이 측정된 경우에만 semantic index/reranker 도입

### Phase 4 — Optional providers and network tools

- external model provider adapters
- provider별 privacy notice
- web search tool
- domain allowlist와 citation
- Vault content egress approval

### Phase 5 — Advanced harness

- reusable workflows
- bounded multi-step agent runs
- checkpoint/resume
- optional long-term memory
- 필요성이 증명된 경우에만 companion engine 재검토

## 16. MVP Acceptance Criteria

1. 사용자는 current note 또는 selection을 context로 질문할 수 있다.
2. local provider 연결 실패가 Obsidian을 멈추지 않고 actionable error를 보여준다.
3. Agent Harness가 `search_vault`와 `read_note`만 호출한다.
4. 모든 model request가 configured context budget 이하다.
5. 답변에는 실제 사용한 source path/heading이 표시된다.
6. 동일 evidence가 중복으로 model context에 들어가지 않는다.
7. tool activity는 각 call당 한 번만 표시된다.
8. streaming text가 중복·누락되지 않는다.
9. stop, timeout, provider error 후 입력이 다시 가능하다.
10. 결과는 승인 전까지 Vault를 변경하지 않는다.
11. 승인 삽입은 Obsidian undo로 되돌릴 수 있다.
12. plugin unload 시 worker, request, event listener가 모두 정리된다.

## 17. 테스트 전략

### Unit

- context budget
- evidence dedupe/selection
- source preservation
- streaming accumulator
- run-state transitions
- provider error mapping
- tool permission decisions

### Integration

- fake local LLM streaming server
- Obsidian Vault adapter fixture
- search → read → answer
- abort/timeout/context overflow
- plugin unload cleanup

### Product fixture

작은 fixture Vault를 만들고 다음 고정 질문을 검증한다.

```text
현재 노트의 주장과 관련된 Vault 문서를 찾아 핵심 근거를 요약하고 출처를 보여줘.
```

평가 항목:

- 필요한 source 선택
- 불필요한 source 제외
- context budget 준수
- citation 정확성
- 중복 tool call 없음
- 최종 답변 완결성

## 18. 아직 결정되지 않은 사항

새 프로젝트에서 한 번에 하나씩 결정한다.

1. UI 구현: Obsidian DOM API 중심 vs React 기반 view
2. local provider 1차 지원: Ollama native API vs OpenAI-compatible API
3. plugin 설정에서 model discovery 범위
4. lexical retrieval 구현과 cache 전략
5. citation의 최소 단위: note/heading/block/range
6. insert preview의 diff UX
7. LangChain을 어느 adapter 계층까지 사용할지
8. external provider의 key 저장 방식
9. web search provider와 network permission UX
10. 제품명

## 19. 새 세션의 첫 작업

새 세션에서는 구현부터 시작하지 않는다. 다음 순서로 진행한다.

1. 이 handoff 전체 읽기
2. 새 프로젝트의 `CONTEXT.md`와 ADR 2개 작성
3. MVP acceptance criteria 확인
4. UI framework 결정을 하나의 질문으로 논의
5. Obsidian sample plugin skeleton 생성
6. Agent Harness state machine과 fake provider를 먼저 구현
7. 실제 local provider 연결 전 deterministic tests 확보

## 20. 새 세션 시작 프롬프트

아래 내용을 새 프로젝트의 첫 Codex 세션에 그대로 전달할 수 있다.

```text
이 프로젝트는 desktop-only Obsidian-native AI workspace다. MCP server나 범용 CLI를 만드는 프로젝트가 아니다.

핵심 사용자 경험은 Vault Copilot이다. 사용자가 현재 노트나 선택 영역에서 질문하면, Agent Harness가 현재 문맥과 필요한 Vault evidence만 선택해 local LLM에 전달하고, 출처가 연결된 답변을 생성한다. 결과는 preview/diff 후 사용자가 승인한 경우에만 현재 노트에 삽입한다.

Agent Harness는 model selection, tool registry, context budget, permissions, cancellation, retries, execution trace를 소유한다. local LLM은 Ollama/llama.cpp/LM Studio 같은 별도 local provider를 localhost API로 호출한다. 제품 전용 companion process는 초기에는 만들지 않는다. 외부 model provider와 web search는 후속 opt-in 기능이다.

MVP tool은 read-only search_vault와 read_note뿐이다. LangChain은 선택 가능한 구현 library이며 제품 정책이나 state machine을 소유하면 안 된다. MCP transport, Ink UI, LanceDB native dependency, chokidar watcher, 기존 CLI agent loop는 이식하지 않는다.

먼저 이 저장소의 CONTEXT.md와 docs/adr를 읽고, handoff의 미결정 사항 중 UI framework 결정을 한 번에 하나의 질문으로 논의하라. 구현 전에 acceptance criteria와 test seam을 고정하라.
```

## 21. 기존 결정 기록

기존 저장소에서 이미 기록한 결정:

- `docs/adr/0001-agent-context-pipeline-over-search-backend.md`
- `docs/adr/0002-obsidian-native-product-boundary.md`

새 프로젝트에서는 MCP 관련 표현을 제거해 새 번호로 복사·정리한다. 과거 저장소 경로나 구현을 새 제품 domain language로 가져오지 않는다.
