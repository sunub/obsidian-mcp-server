# Skill로 분리해야 하는 부분

위치: `plugin/skills/<skill-name>/SKILL.md`

Skill은 **LLM의 추론, 사용자 규칙, 출력 형식, 승인 절차**를 소유합니다. 현재 MCP 도구 `description`과 규칙 기반 휴리스틱 코드에 흩어져 있는 지시문을 Skill로 모아 단일 진실 공급원(Single Source of Truth)을 만듭니다.

---

## 1. `vault-tidy` (기존 구현 유지 + MCP 중복 제거)

- 현재 위치: `plugin/skills/vault-tidy/SKILL.md`
- 역할: Vault 정돈의 전체 대화 흐름과 판단 기준을 정의합니다.
  - 범위 결정(전체 vs 특정 최상위 폴더 `scope`) → `tidy_plan` 호출
  - 위험도 3티어 미리보기 출력: `bulk`(요약 표 + 예시 5개 일괄 승인), `per_item`(번호별 선택 표), `report`(안내만, 실행 금지)
  - `needsTitle` 무제 노트 제목 제안 규칙(본문 핵심 주제 명사구, 30자 이내, 같은 폴더 이름 중복 금지, 날짜만 사용 금지)
  - 사용자가 승인한 `approvedOpIds`·`renames`만 `plan_apply`에 전달
  - 결과 보고(`rejected` 사유, `runId` 및 되돌리기 안내) 및 `plan_undo` 시 `conflicts` 안내
  - 셸 명령(`mv`, `rm` 등) 금지
- 정리 완료:
  - `src/tools/tidy/index.ts`, `src/tools/plan/apply.ts`, `src/tools/plan/undo.ts`의 `description`에서 중복된 대화 절차 문구를 제거하고 입출력 계약과 부작용만 남겼습니다.
- 남은 확장 작업:
  - 2단계(주제별 재구성 & 허브 노트)가 추가되면 하위 폴더 구조 제안 기준을 이 Skill 또는 별도 `vault-reorganize` Skill로 확장합니다.

---

## 2. `vault-frontmatter` (신설 — 3단계)

- 출발점: `docs/frontmatter-skill-draft.md` (과거 `generate_property`, `create_document_with_properties`에서 분리한 지시문 초안)
- 역할:
  - 노트 유형 분류: **블로그 글**(`title`, `slug`, `date`, `category`, `tags`, `summary`, `completed`) vs **일반 노트**(최소 필수 속성) 규칙 구분
  - 기존 Vault 태그·카테고리 일관성 유지: 새 태그를 임의로 만들기 전에 기존 Vault 속성 목록(신규 MCP 도구 `vault_list_properties` 예정)을 먼저 조회해 재사용
  - 작성 절차: 대상 노트 읽기 → 기존 frontmatter 확인 → 누락/갱신할 속성 JSON을 표로 미리보기 → 사용자 승인(덮어쓰기 여부 포함) → 범용 `write_property` 호출
- Skill로 두는 이유:
  - `slug` 생성 규칙, `summary` 톤, 블로그 vs 일반 노트 판별은 사용자마다 바뀌는 정책이며, 코드 스키마(`write_property/params.ts`)에 하드코딩할 대상이 아닙니다.

---

## 3. `vault-context` (보류)

`collect_context`의 규칙 기반 요약을 대신할 Skill로 계획했습니다. 해당 요약은 제거했고, `collect_context`를 남길지는 정하지 않았습니다([검토 기록](../collect-context-review.md)).

- 지금은 별도 Skill을 만들지 않습니다. 호스트 LLM이 `search`와 `read`의 결과를 읽고 직접 종합합니다.
- 출처 표시나 근거 수집 절차가 반복해서 필요해지면 그때 다시 검토합니다.

---

## 4. 검색 상태 안내 (적용, 미커밋)

- MCP 도구는 `search_status`(`mode`, `reason`, `setup_command`, `indexing`)만 반환합니다.
- 도구 설명은 필드의 의미만 적습니다. 사용자에게 알릴지는 호스트 LLM이 상황에 맞게 정합니다.

---

## 5. Skill 작성 시 공통 원칙

- **단일 진실 공급원**: Skill에 적은 절차는 MCP `description`이나 `src/server.ts`의 `instructions`에 중복 작성하지 않습니다.
- **안전 규칙은 Skill에만 의존하지 않음**: 최상위 폴더 경계, Vault 밖 쓰기 금지, stale file 거부는 Skill에도 안내하되 반드시 MCP 코드와 Hook이 강제합니다.
- **트리거 경계 명확화**: frontmatter의 `description`에 한국어·영어 트리거 문구를 구체적으로 적어 의도하지 않은 자동 활성화를 줄이고, 명시적 진입이 필요한 작업은 Command와 쌍으로 연결합니다.
