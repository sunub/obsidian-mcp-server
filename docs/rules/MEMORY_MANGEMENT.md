# Obsidian MCP Server 메모리 관리 및 자원 해제 설계(Architecture) 계획서

본 문서는 obsidian-mcp-server의 완전 로컬 구동 환경(Ollama, LanceDB)에서 발생할 수 있는 V8 엔진 메모리 누수 및 로컬 파일 시스템 락(Lock) 문제를 원천 차단하기 위한 아키텍처 설계 명세입니다.

로컬 RAG 파이프라인과 CLI 기반 UI(React Ink)가 결합된 본 프로젝트의 특수성을 고려하여, 단일 진실 공급원(SSOT) 기반의 자원 회수, UI 가시성(Scrollback)과 LLM 컨텍스트의 생명주기 분리, 그리고 크리티컬 패스(Critical Path)에서의 OOM 방지를 핵심 설계 원칙으로 삼습니다.

## 1. 핵심 컴포넌트 명세 및 동작 원리

각 자원 관리 객체는 캡슐화된 해제 로직(Disposable Pattern)을 가져야 하며, 전역 레지스트리를 통해 생명주기가 통제되어야 합니다.

### 1.1. CleanupManager (위치: src/cli/utils/cleanup.ts)

애플리케이션의 Graceful Shutdown을 보장하는 전역 중앙 제어 객체입니다.

의도: 각 모듈에 분산된 자원 해제 로직을 한 곳으로 모아, 어떠한 종료 시나리오에서도 누락 없이 자원이 반환되도록 강제합니다.

메서드: register(taskName: string, task: () => Promise<void> | void)

각 서비스(VectorDB, 서버, 로거 등)가 인스턴스화되는 시점에 호출되어 해제 로직을 LIFO(후입선출) 구조의 큐에 등록합니다.

메서드: executeAll(timeoutMs: number = 3000)

데드락 방지(Hard Timeout): 특정 모듈의 해제 로직이 버그로 인해 무한 대기(Pending) 상태에 빠지는 것을 방지하기 위해 Promise.race를 사용합니다. 지정된 시간(기본 3초) 내에 모든 작업이 완료되지 않으면 남아있는 작업을 무시하고 프로세스 종료 권한을 OS로 반환합니다.

### 1.2. VectorDB (위치: src/utils/VectorDB.ts)

LanceDB와 같은 Memory-Mapped 기반 로컬 데이터베이스의 커넥션을 관리합니다.

의도: 로컬 인덱싱 작업 중 프로세스가 비정상 종료될 경우 발생하는 파일 손상(Corruption)과 영구적인 메모리 점유를 방지합니다.

메서드: disconnect()

활성화된 DB 커넥션을 안전하게 닫고, 메모리에 적재된 인덱스 캐시 참조를 강제로 해제합니다. 이 메서드는 반드시 CleanupManager에 최우선 순위로 등록되어야 합니다.

대규모 디렉토리 스캔(DirectoryWalker) 및 인덱싱(RAGIndexer)이 끝난 직후, 연결을 계속 유지하는 대신 캐시 플러시(Flush)를 통해 OS에 메모리 반환을 명시적으로 요청해야 합니다.

### 1.3. LlmStreamManager (위치: src/cli/hooks/useLlmStream/useLlmStream.ts)

모든 비동기 네트워크 및 I/O 작업의 취소를 통제합니다.

의도: 로컬 LLM 추론과 같이 CPU와 VRAM을 강하게 점유하는 작업을 사용자가 취소했을 때, 즉각적으로 자원을 회수합니다.

상태: activeController: AbortController | null

쿼리 시작 시 생성되는 단일 진실 공급원입니다. 하위의 모든 Tool 실행과 Fetch 요청에 이 컨트롤러의 signal이 의존성으로 주입됩니다.

메서드: abortCurrentStream()

activeController.abort()를 호출하여 이벤트 루프 내의 대기 중인 프로미스를 즉시 파기하고 소켓 버퍼를 비웁니다.

### 1.4. HistoryManager (위치: src/cli/hooks/useHistoryManager.ts)

React 기반 CLI UI의 렌더링 오버헤드와 로컬 LLM의 컨텍스트 윈도우 한계를 동시에 제어합니다.

의도: 이전 대화가 무한히 누적되어 OOM이 발생하는 것을 막되, 과거의 문맥(Context)과 터미널 화면에서의 가시성(Visibility)은 훼손하지 않습니다.

상태 분리 구조:

llmContext: 실제 Ollama 모델로 전송되는 JSON 메시지 배열. (용량 제한 엄격)

uiHistory: 현재 렌더링 중인 React 상태. (스크롤백 위임 후 점진적 참조 해제)

메서드: pruneAndCompressHistory(maxTurns: number = 20)

## 2단계 컨텍스트 보호

- 1차 방어선(Truncation): 턴이 한계를 초과하면 가장 오래된 메시지를 배열에서 단순히 잘라내어(Slice) LLM의 OOM을 즉각 방어합니다.

- 2차 방어선(Debounced Summarization): 사용자가 답변을 기다리는 크리티컬 패스 외부(백그라운드 큐)에서, 잘려나간 대화들을 요약하여 시스템 프롬프트에 압축(Compression) 병합합니다. 이를 통해 동기적인 추가 LLM 요청으로 인한 성능 저하를 차단합니다.

메서드: flushToStorage(isSynchronous: boolean = false)

메모리에서 해제된 원본 대화를 .sqlite 또는 JSON으로 디스크에 영구 보존합니다.

정상적인 턴 종료 시에는 비동기(fs.promises) 처리하지만, 프로세스 종료 시그널에 의해 호출될 때는 동기식(fs.writeFileSync)으로 작동하도록 플래그를 받아 이벤트 루프 종료 전 디스크 기록을 물리적으로 보장합니다.

### 사용자 쿼리 라이프사이클 메모리 흐름

사용자 입력부터 응답 완료 및 메모리 해제까지의 정확한 파이프라인입니다.

초기화 및 제어권 생성:

사용자의 쿼리가 접수되면 LlmStreamManager가 새 AbortController를 생성합니다.

최소 단위 데이터 수집 (RAG):

VectorDB가 호출되어 문서를 검색합니다. 수십 개의 노드가 검색되더라도 프롬프트에 주입할 최소한의 텍스트만 추출하여 결합하고, 원본 검색 결과 배열은 스코프(Scope)를 즉시 벗어나도록 설계하여 GC를 유도합니다.

스트리밍 및 UI 스크롤백 위임:

응답이 청크 단위로 수신될 때, Ink의 <Static> 컴포넌트 또는 표준 출력(stdout)을 활용합니다.

이를 통해 렌더링이 완료된 과거의 텍스트는 터미널 에뮬레이터 고유의 스크롤백 버퍼로 밀어내고, Node.js 측의 React Virtual DOM 트리에서는 해당 노드의 참조를 끊어 렌더링 연산 비용과 힙 메모리를 절약합니다.

턴 종료 및 후처리 (Cleanup):

스트리밍이 완료되면 activeController를 해제합니다.

HistoryManager.pruneAndCompressHistory()를 호출하여 llmContext를 제한선 아래로 유지하고, 백그라운드에서 디스크 플러시(flushToStorage(false))를 스케줄링합니다.

## 3. 예외 및 종료 시나리오별 대응 전략

어떠한 상황에서도 데이터의 정합성과 파일 시스템의 안전을 보장하기 위한 3단계 전략입니다.

### 3.1. 사용자 개입 (Ctrl+C 2회 클릭 Graceful Shutdown)

1회 입력 (SIGINT 수신):

LlmStreamManager.abortCurrentStream()을 즉시 호출합니다. 이는 애플리케이션을 끄는 것이 아니라 현재 실행 중인 토큰 생성 및 검색만 취소하는 "소프트 중단"입니다.

1초 이내 2회 입력:

하드 종료 절차로 전환합니다.

CleanupManager.executeAll()을 호출하여 DB 연결 해제 및 동기식 파일 플러시(flushToStorage(true))를 3초 타임아웃 내에 수행한 후 process.exit(0)을 실행합니다.

### 3.2. 크래시 및 패닉 (Crash/Error) 대처

이벤트 인터셉트: uncaughtException 및 unhandledRejection 발생 시 제어권을 가로챕니다.

동기적 기록 보장: 이벤트 루프가 붕괴되는 시점이므로, 에러 스택 트레이스와 메모리 상의 잔여 데이터를 반드시 동기식 I/O(writeFileSync)로 파일에 덤프(Dump)합니다. 비동기 작업이 펜딩될 수 있으므로 CleanupManager의 동작은 제한적으로 시도합니다.

### 3.3. 다음 시작 시 자가 치유 (Self-Healing)

메인 서버 엔트리포인트(src/setup.ts 등)의 최상단에는 cleanupCheckpoints() 함수가 위치해야 합니다.

이전 세션에서 3.2와 같은 크래시로 인해 해제되지 못한 VectorDB의 잔여 Lock 파일이나 처리 중이던 임시 청크 파일이 존재할 경우, 시작 시점에 이를 스캔하고 무조건 삭제하여 깨끗한 런타임 환경을 재구축합니다.
