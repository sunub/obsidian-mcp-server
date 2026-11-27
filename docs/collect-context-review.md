# `collect_context` 검토 기록

- 기준일: 2026-11-26
- 대상: `vault` 도구의 `collect_context` 액션 (`src/tools/vault/utils/actions/collect_context.ts`)
- 상태: **제거함 (2026-11-27).** `search`에 이어 받기를 추가할지는 정하지 않았다.
- 아래 내용은 제거 전에 한 검토의 기록이다. 코드 줄 번호와 파일은 현재 저장소에 없다.

## 1. 검토 배경

도구와 에이전트의 역할이 섞인 곳을 찾다가 검색 관련 코드를 검토했다. 구분 기준은 다음과 같다.

> 도구는 찾은 사실을 돌려준다. 그 뜻이 무엇이고 다음에 무엇을 할지는 에이전트가 정한다.

`collect_context`에는 LLM을 부르거나 도구를 이어 호출하는 반복이 없다. 즉 에이전트는 아니다. 다만 에이전트가 할 해석을 고정 규칙으로 흉내 내는 출력이 있었다.

## 2. 적용한 변경

### 2.1 검색 상태 전달

| 이전 | 이후 |
|---|---|
| `<system_directive>` 태그에 안내 문장을 담음 | 결과의 `search_status` 필드 |
| 도구 설명이 "반드시 전달하라"고 지시 | 필드의 의미만 설명 |
| 모델 없음 안내는 한 번만 | 검색할 때마다 현재 상태 포함 |

`search`와 `collect_context`에 함께 적용했다. 타입은 `src/shared/searchStatus.ts`에 있다.

### 2.2 해석을 흉내 내던 출력 제거

| 제거한 항목 | 제거 이유 | 대체 |
|---|---|---|
| `memory_packet.openQuestions` | "범위를 넓힐까?" 같은 에이전트의 판단을 고정 문장으로 생성 | 없음 |
| `memory_packet.confidence` | 내용과 무관하게 문서 수와 잘림 비율로 계산 | 없음 |
| `relevance` | 문자열 포함 여부로 판정해 검색 순위와 어긋날 수 있음 | `rank`, `score` |
| `memory_packet`의 `topicSummary`, `keyFacts`, `experienceBullets`, `sourceRefs` | 문서 내용을 잘라 다시 묶은 중복 | 없음 |
| `summary`, `evidence_snippets` | 검색 결과와 무관한 규칙으로 고른 줄 | `matched_snippets`, `excerpt` |

검색에 걸리지 않은 문서는 `rank`와 `score`가 `null`이다. 캐시 스키마 버전은 `collect_context.v2`로 올렸다.

## 3. 필요성 검증

### 3.1 측정 조건

- Vault: `tmp-obsidian-vault`
- 검색 방식: 로컬 모델이 없는 키워드 검색
- 주제: `react`, `http`, `typescript`
- 2.2의 변경을 적용한 빌드

### 3.2 측정 결과

문서 칸은 `반환 수 / 검색 일치 수`, 크기는 문자 수다.

| 주제 | 호출 | 문서 | 응답 | 발췌 본문 | 일치 조각 | 설정 한도 |
|---|---|---|---:|---:|---:|---:|
| react | `search` 기본 | 1 / 10 | 1,636 | 20 | 467 | 800 |
| react | `search` balanced | 2 / 10 | 2,869 | 40 | 893 | 2,500 |
| react | `collect_context` 기본 | 1 / 100 | 2,164 | 223 | 83 | 1,200 |
| react | `collect_context` balanced | 5 / 100 | 5,903 | 1,115 | 415 | 5,200 |
| react | `collect_context` none | 20 / 100 | 49,982 | 32,244 | 4,460 | 없음 |
| http | `search` 기본 | 1 / 10 | 1,536 | 20 | 443 | 800 |
| http | `search` balanced | 2 / 10 | 2,539 | 40 | 886 | 2,500 |
| http | `collect_context` 기본 | 1 / 67 | 2,136 | 223 | 83 | 1,200 |
| http | `collect_context` balanced | 6 / 67 | 6,366 | 1,338 | 498 | 5,200 |
| http | `collect_context` none | 20 / 67 | 49,911 | 32,829 | 4,437 | 없음 |
| typescript | `search` 기본 | 1 / 10 | 1,564 | 20 | 432 | 800 |
| typescript | `search` balanced | 2 / 10 | 2,357 | 40 | 665 | 2,500 |
| typescript | `collect_context` 기본 | 1 / 60 | 2,188 | 223 | 83 | 1,200 |
| typescript | `collect_context` balanced | 6 / 60 | 6,443 | 1,338 | 498 | 5,200 |
| typescript | `collect_context` none | 20 / 60 | 51,966 | 35,129 | 4,427 | 없음 |

기본 설정(`maxDocs: 10`만 지정)으로 문서 10건을 모으면 세 주제 모두 호출 10번, 합계 약 21,500~21,900자가 들었다.

### 3.3 확인한 문제

- **기본값에서 배치가 되지 않는다.** `maxDocs` 기본값은 20이지만 출력 한도 때문에 한 번에 1건만 온다.
- **본문 비중이 낮다.** 기본과 balanced에서 발췌 본문은 응답의 10~21%다. 나머지에는 일치 조각 외에 경로, 해시, 통계, 캐시 키가 들어간다.
- **응답이 설정 한도를 넘는다.** 들여쓰기 직렬화와 "문서 1건 아래로는 줄이지 않음"이 원인으로 보이나 따로 검증하지 않았다. `search`도 한도를 넘는다.
- **캐시가 작업을 아끼지 않는다.** 문서를 모두 읽고 결과를 만든 뒤에 캐시를 조회한다(619~656행).
- **출력 절단이 두 번 있다.** 순회 중(557~603행)과 마지막(676~683행).
- **`truncated`가 부정확하다.** 25자 노트도 `true`였다. 원문 길이와 공백을 정리한 발췌 길이를 비교하기 때문으로 보인다.

### 3.4 기능별 판단

| 기능 | 판단 |
|---|---|
| 검색과 순위 | `search`와 같은 `hybridSearch` 호출. 중복 |
| 발췌 | `search`의 `excerptLength`와 `read`로 대부분 대체 가능 |
| `continuationToken` | 고유 기능. `search`에 `offset`을 추가하면 대체 가능 |
| `scope: "all"` 순회 | `list_all`과 겹침. 발췌와 이어 받기가 다름 |
| `doc_hash`, `backlinks_count` | `search`에 없음. 읽는 곳을 저장소에서 찾지 못함 |

### 3.5 사용 여부

- 저장소의 스킬과 스크립트에서 호출하는 곳을 찾지 못했다. 도구 코드, 설명, 테스트, 문서에만 있다.
- 사용 기록은 `VAULT_METRICS_LOG_PATH`를 설정해야 남는데 `plugin/.mcp.json`에는 없다. 실제 사용 빈도는 알 수 없다.
- 외부 클라이언트의 사용 여부는 확인할 수 없다.

## 4. 권장안

`collect_context`를 제거하고 `search`를 보완한다.

1. `search`에 `offset` 입력과 `next_offset` 출력을 추가한다.
2. `search`의 기본 반환 수와 문서당 부가 정보를 함께 손본다. `offset`만 추가하면 호출 수 문제가 남는다.
3. `collect_context`의 코드, 타입, 캐시, 전용 파라미터, 테스트, 안내 문서를 제거한다.
4. `vault` 설명에서 여러 노트를 종합할 때는 `search` 후 필요한 노트를 `read`하도록 안내한다.

대안은 액션을 남기고 캐시, 중복 절단, 부가 필드를 줄이는 것이다.

## 5. 결정 전에 남은 확인

- 하이브리드 검색 모드에서는 측정하지 않았다. 중복과 캐시에 대한 판단은 코드에 근거한다.
- 제거하면 `collect_context`를 호출하는 외부 클라이언트가 깨진다.
- 이어 받기 중에 Vault가 바뀌면 `offset` 방식은 문서가 누락되거나 겹칠 수 있다. 현재 토큰 방식도 위치 기반이라 같은 한계가 있다.

## 6. 관련 문서

- [plugin-transition/mcp-core.md](./plugin-transition/mcp-core.md): `vault` 액션별 처분 계획
