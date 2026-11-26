# MCP로 남겨야 하는 부분과 리팩터링 대상

대상 코드: `src/tools/`, `src/server.ts`, `src/index.ts`, `src/shared/vault-ops/`

MCP 서버는 **항상 동일하게 동작해야 하는 결정론적 손발과 상태 엔진**만 소유합니다. 판단 규칙, 대화형 안내, 요약 휴리스틱은 덜어냅니다.

---

## 1. 그대로 MCP 코어로 유지할 기능

### 1.1 Vault 정리 및 복원 엔진 (`tidy_plan`, `plan_apply`, `plan_undo`)
- 위치: `src/shared/vault-ops/`, `src/tools/tidy/`, `src/tools/plan/`
- 유지 이유: 파일 해시 비교(stale plan 거부), 최상위 폴더 경계 강제(`boundary.ts`), Obsidian 링크 파싱/해석/재작성(`links.ts`, `rewritePlan.ts`), `.trash/` 이동, `.vault-tidy/runs/<runId>.json` 저널 기반 역순 복원(`apply.ts`, `journal.ts`)은 프롬프트로 대체할 수 없는 안전 코어입니다.
- 개선할 점:
  - `src/tools/tidy/index.ts`(L30-38), `src/tools/plan/apply.ts`, `src/tools/plan/undo.ts`의 `description`에 들어 있는 대화 절차 지시문은 `vault-tidy` Skill과 중복됩니다. MCP `description`에는 입출력 계약과 부작용만 남깁니다.

### 1.2 Frontmatter 안전 쓰기 (`write_property`) + 조회 도구 신설
- 위치: `src/tools/write_property/`
- 유지 이유: YAML frontmatter 파싱·병합 직렬화 실수 방지와 `VaultPathError` 기반 Vault 바깥 쓰기 차단.
- 개선할 점:
  - `src/tools/write_property/params.ts`(L31-42)의 `obsidianPropertySchema`가 블로그 중심 고정 필드(`cssclasses`, `slug`, `category`, `completed` 등)로 하드코딩돼 있습니다. MCP 도구는 **임의 key-value frontmatter를 병합/덮어쓰는 범용 쓰기 도구**로 바꾸고, 노트 유형별 스키마는 `vault-frontmatter` Skill이 관리합니다.
  - 3단계 `vault-frontmatter` Skill이 기존 태그·속성을 일관되게 재사용할 수 있도록 **Vault 내 기존 태그·속성 목록을 읽는 읽기 전용 도구**(예: `vault_list_properties`) 추가가 필요합니다.
  - `src/tools/write_property/index.ts`(L142-145)의 `shorthandDescription`은 분리된 CLI 잔재이므로 제거합니다.

---

## 2. 분해 및 축소가 필요한 `vault` 도구 (`src/tools/vault/`)

현재 `vault` 도구 하나가 `obsidianContentActions` 6개와 파라미터 16개를 한 스키마에 묶고 있습니다(`src/tools/vault/params.ts`). 액션별로 성격이 달라 분해가 필요합니다.

| 현재 action | 처분 | 변경 후 역할 |
|---|---|---|
| `search` | **독립 MCP 도구 유지** (`vault_search`) | 로컬 BM25(`Indexer`) + LanceDB 벡터 검색 + RRF 융합. 호스트 도구(`Grep`)가 대체 불가 |
| `read` | **축소 유지** (`vault_read`) | 단순 원문 읽기는 호스트 `Read`와 중복. 파일명 해석, frontmatter 파싱, **backlinks 조회**, 긴 문서의 `query` 기반 단락 필터링(`read.ts` L93-106)에 집중 |
| `collect_context` | **미결정 (제거 권장)** | 규칙 기반 요약은 제거했습니다. 검색과 발췌가 `search`, `read`와 겹쳐, 제거하고 `search`에 이어 받기를 추가하는 안을 권장합니다. 근거: [검토 기록](../collect-context-review.md) |
| `list_all` | **재정의 또는 통합** | 단순 경로 나열은 호스트 `Glob`과 중복. frontmatter 메타데이터(`tags`, `category`, `completed`) 필터링 목록으로 특화하거나 `vault_scan` 계열로 통합 |
| `stats` | **독립 MCP 도구 유지** (`vault_stats`) | Vault 문서 수, 인덱스 상태, 로컬 모델 준비 상태를 구조화된 JSON으로 반환 (`/vault-status` Command 백엔드) |
| `index_vault_to_vectordb` | **MCP 동기 호출 제거 검토** | `index_rag.ts`(L16)가 전체 색인을 동기로 실행해 타임아웃 위험이 크고, AI가 임의 호출하면 안 되는 운영 작업. CLI 서브커맨드(`obsidian-mcp-server reindex`) 또는 비동기 작업으로 전환 |

### `vault` 내부에서 제거할 레거시 패턴
- **`<system_directive>` 텍스트 주입 제거 (적용, 미커밋)**: `search`와 `collect_context`는 `search_status` 필드(`src/shared/searchStatus.ts`)로 검색 상태를 반환합니다.
- **`shorthandDescription` 제거**: `vault/index.ts`(L137-140)의 CLI 잔재.

---

## 3. `src/server.ts` 및 런타임 인프라 정리

- **유지할 것**:
  - `McpServer` 생성과 `ServerLifecycle.runToolCall` 래핑(`src/server.ts` L59-69).
- **고쳐야 할 것**:
  - **오래된 `instructions` 축소(`src/server.ts` L36-55)**: 이미 제거된 `Reranking`이 남아 있고 `stats`·`collect_context`가 누락돼 있습니다. 도구별 사용 절차는 Skill/Command로 옮기고, 서버 `instructions`는 `VAULT_DIR_PATH` 범위와 최소 정체성만 남깁니다.
  - **도구 등록 DI 통일(`src/server.ts` L71-78)**: 전역 `state` 싱글턴을 쓰는 `tools`(`vault`, `write_property`)와 `VaultToolDeps`를 주입받는 `toolsWithDeps`(`tidy_plan`, `plan_apply`, `plan_undo`)의 이원화를 없애고 전부 `VaultToolDeps` 기반으로 통일합니다.
- **기동·감시 비용 점검(`src/index.ts`, `src/shared/vault-manager/VaultWatcher.ts`)**:
  - 현재 서버 시작 시 정리 기능만 쓰려 해도 로컬 모델 체크와 `chokidar` 기반 `VaultWatcher`를 무조건 기동합니다.
  - `plan_apply`로 대량 파일을 이동할 때 `chokidar`가 파일마다 `unlink`/`add` 이벤트를 쏟아내며 `RAGIndexer` 부하가 튈 수 있어, 일괄 변경 시 디바운스 또는 배치 동기화 검토가 필요합니다.

---

## 4. 미결 설계 포인트 (구현 전 결정 필요)

1. **`src/tools/plan/confirm.ts` 연결 여부**:
   - MCP `elicitation`으로 클라이언트 네이티브 확인 팝업을 띄우는 `elicitConfirmer`가 구현돼 있지만 `apply.ts`에 연결되지 않았습니다.
   - Skill 대화 승인만으로 갈지, 클라이언트가 `elicitation.form`을 지원할 때 서버 레벨 이중 승인을 걸지 결정이 필요합니다.
2. **2단계(주제별 재구성)의 임베딩 의존 경로**:
   - 임베딩·벡터 검색 코드는 `src/shared/local-ai/`와 `src/shared/indexing/`에 있어 `src/tools/`에서 `@shared/*`로 import할 수 있습니다.
