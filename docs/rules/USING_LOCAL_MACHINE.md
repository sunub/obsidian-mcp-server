## 문제점 : 현재는 AI AGENT, AI Service 들에 강하게 묶여 있는 문제가 있다

현재 이 프로젝트가 수행하는 기능들이 외부의 영향이 필요없는 기능들임에도 불구하고 클라이언트 AI 를 사용하여 기능을 수행하고 있다는 문제점이 있습니다. 현재 작업들을 로컬 AI Agent 들이 수행하도록 변경하는 작업이 필요합니다.

예를들어, Ollama 나 LocalAI 같은 로컬 AI Agent 들을 사용하여 기능들을 수행하도록 변경하는 작업이 필요합니다. 이렇게 하면 외부의 영향 없이도 기능들을 수행할 수 있게 되어, 프로젝트의 안정성과 독립성이 향상될 것입니다.

## 필요한 내용

1. ollama는 ai agent 와 같이 mcp server 를 사용할 수 없기 때문에 클라이언트

### ⚙️ 1. 필수 구성 요소 (The Four Pillars)

| 구성 요소 | 역할 | 핵심 기술 | 왜 필요한가? |
| :--- | :--- | :--- | :--- |
| **1. LLM API 클라이언트** | 로컬 LLM (Ollama)과 통신하는 인터페이스. | HTTP Request Library (e.g., Python
`requests`) | LLM에게 "질문"하고, LLM의 "응답"을 받아오는 통로입니다. |
| **2. 도구 정의 및 관리자 (Tool Registry)** | LLM이 사용할 수 있는 모든 외부 함수(API)와 그 사용 방법을 정의.
| Python 함수, Docstring, 타입 힌트 (Type Hint) | LLM에게 "당신은 이런 도구를 사용할 수 있어"라고 명확하게 가르쳐
야 합니다. |
| **3. 오케스트레이터 (The Orchestrator)** | **전체 흐름을 제어하는 메인 코드.** (가장 중요!) | Python Logic, 조
건문 (If/Else), 루프 (While) | LLM의 출력 $\rightarrow$ 판단 $\rightarrow$ 실행 $\rightarrow$ 결과 반영
$\rightarrow$ 재질문 과정을 관리합니다. |
| **4. 외부 API 클라이언트** | 실제 외부 데이터를 가져오는 코드. | HTTP Request Library (e.g., Python
`requests`) | 실시간 날씨, 주가 등 외부 세상의 데이터를 가져오는 실행 엔진입니다. |
