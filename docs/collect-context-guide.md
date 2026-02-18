# collect_context 사용/동작 가이드

이 문서는 `vault` 액션 중 `collect_context`만 집중 설명합니다.  
도구 전체 사용법과 호출 선택 기준은 `docs/tools-usage-guide.md`를 먼저 확인하세요.

이 문서는 `vault` 액션의 `collect_context`를 실제 운영에서 어떻게 사용하고,  
내부에서 어떤 단계로 처리되는지 설명합니다.

## 1) 이 문서로 얻을 수 있는 것

`collect_context`는 다음 목적을 가집니다.

- 여러 문서를 배치 단위로 수집해 요약 구조로 축약
- 증거 조각과 핵심 문장을 뽑아 AI가 바로 사용할 수 있는 컨텍스트 구성
- 출력 크기 제약을 넘어갈 때 `continuationToken`으로 이어서 수집
- 필요 시 `memory/context_memory_snapshot.v1.md`에 canonical 저장

`search`/`read`/`list_all`이 단발 조회라면, `collect_context`는 “문맥 축적” 액션입니다.

---

## 2) 언제 `collect_context`를 써야 하나?

아래 상황에서 가장 효과적입니다.

- “요약해서 기억해줘”, “관련 내용을 컨텍스트로 정리해줘” 같은 요청
- 장문의 주제 조사 후에도 토큰 예산을 지키며 단계적으로 수집해야 할 때
- 대화 여러 턴에서 재활용 가능한 노트 형태의 컨텍스트가 필요할 때
- 동일 질의 반복 호출이 잦고 캐시 재사용이 유리한 경우

반대로, 즉시 한두 건의 원문 조회가 목적이면 `read`/`search`가 더 단순합니다.

---

## 3) 액션 입력 파라미터 (실무 정리)

`collect_context`는 `obsidian` 툴 호출 시 다음 필드를 사용합니다.

- `action`: 항상 `"collect_context"`  
- `topic`: 검색 주제. `scope="topic"`일 때 사실상 필수
- `scope`: `"topic"`(키워드 검색 후보) 또는 `"all"`(전체 후보)
- `maxDocs`: 배치당 최대 문서 수(기본 20)
- `maxCharsPerDoc`: 문서별 추출 최대 문자(기본 1800)
- `memoryMode`: `"response_only"` | `"vault_note"` | `"both"`
- `continuationToken`: 이어서 수집할 때 사용
- `maxOutputChars`: 응답 JSON 크기 제한
- `compressionMode`: `"aggressive" | "balanced" | "none"`
- `quiet`: true면 축약 응답만 반환
- 공통 공통 파라미터: `limit`/`includeContent`/`excerptLength`는 본 액션에서 핵심은 아님

---

## 4) 대표 템플릿

### 템플릿 A: 주제 스캔

```json
{
  "action": "collect_context",
  "scope": "topic",
  "topic": "ES6",
  "maxDocs": 8,
  "maxCharsPerDoc": 700,
  "compressionMode": "aggressive"
}
```

### 템플릿 B: 전체 문맥 + 저장

```json
{
  "action": "collect_context",
  "scope": "all",
  "maxDocs": 20,
  "maxCharsPerDoc": 1200,
  "memoryMode": "both",
  "compressionMode": "balanced"
}
```

### 템플릿 C: 긴 Vault를 단계 처리

```json
{
  "action": "collect_context",
  "scope": "all",
  "maxDocs": 10,
  "maxCharsPerDoc": 900,
  "maxOutputChars": 2800,
  "compressionMode": "balanced"
}
```

### 템플릿 D: 이어서 수집

```json
{
  "action": "collect_context",
  "continuationToken": "<previous_response.batch.continuation_token>"
}
```

### 템플릿 E: 저장 노트 재호출

```json
{
  "action": "load_memory",
  "memoryPath": "memory/context_memory_snapshot.v1.md"
}
```

---

## 5) 실행 시나리오: “ES6 관련 문서를 수집해서 요약하고 기억해줘”

사용 예시로, 클라이언트가 다음 작업을 구성하는 방식입니다.

1) 수집 시작
```json
{
  "action": "collect_context",
  "scope": "topic",
  "topic": "ES6",
  "maxDocs": 12,
  "maxCharsPerDoc": 900,
  "memoryMode": "both",
  "compressionMode": "balanced"
}
```

2) 반환에서 `batch.has_more=true`면 3)로 이동

3) 이어서 수집
```json
{
  "action": "collect_context",
  "continuationToken": "<previous_response.batch.continuation_token>"
}
```

4) 원하는 시점/마지막 배치 완료 후, `load_memory` 호출

```json
{
  "action": "load_memory"
}
```

5) 이후 대화에서 `load_memory` 결과의 `memory_packet`을 컨텍스트로 주입

---

## 6) 내부 동작(알고리즘) 개요

실제 구현 관점에서의 처리 순서는 아래와 같습니다.

1. 요청 파싱/검증
- `continuationToken`이 있으면 토큰에서 상태 복원
- `scope=topic`인데 `topic`이 비어 있으면 에러

2. 후보군 구성
- `scope=all`이면 전체 문서 인덱스 조회
- `scope=topic`이면 키워드 검색 결과를 후보군으로 사용
- 후보 정렬 기준: `filePath` 오름차순 (재현성/일관성)

3. 후보 순회 및 문서 정규화
- `startCursor` 위치부터 `maxDocs`까지 순회
- 각 문서에 대해:
  - 통계 추출, backlinks, 해시, content preview
  - frontmatter 제거 후 `summary`/`excerpt` 생성
  - 증거 스니펫 추출
  - topic 연관도 추정(`high|medium|low`)

4. 배치 메타 계산
- `matched_total`, `total_in_vault`, `start_cursor`, `consumed_candidates`, `has_more` 계산
- 남은 후보 존재 시 continuation 토큰 생성

5. 압축/가드
- `maxOutputChars` 초과 시 출력 축소를 단계 적용
  - 백링크 수 축소
  - 문서 내 텍스트 길이 축소
  - 마지막으로 문서 수 감소(필요 시)

6. 메모리 패킷 구축
- `memory_packet` 생성:
  - 핵심 사실, 경험 불릿, 소스 레퍼런스, 오픈 질문, 신뢰도
- 저장 모드가 `vault_note` 또는 `both`면 memory note 생성/갱신

7. 최종 반환
- `compression` 메타와 함께 JSON 반환

---

## 7) 응답 필드 해석

- `documents[]`: 현재 배치의 요약된 문서 목록
- `batch.start_cursor`: 현재 배치 시작 위치
- `batch.processed_docs`: 현재 배치에서 반환된 문서 수
- `batch.consumed_candidates`: 후보군 중 소비한 개수
- `batch.has_more`: 다음 배치 존재 여부
- `batch.continuation_token`: 이어서 호출할 토큰 (`has_more=true`일 때 유효)
- `memory_packet`: 모델이 바로 참고할 핵심 요약
- `memory_write`: 저장 상태 (`written`/`failed`/`not_requested`)
- `cache.hit`: 동일한 문서셋/파라미터 반복 요청 시 캐시 재사용 여부
- `compression.truncated`: 출력이 줄였는지 플래그
- `compression.estimated_tokens`: 토큰 비용 추정치

---

## 8) 오류/예외 처리

- `topic parameter is required for collect_context when scope='topic'`
  - 해결: `topic` 값을 넣거나 `scope`를 `all`로 변경
- `Invalid continuationToken for collect_context action`
  - 해결: 최근 응답의 `batch.continuation_token` 사용, 손상 시 첫 배치부터 재시작
- 빈 결과(`matched_total=0`)
  - 대상 주제를 더 좁히거나, `scope=all` + `maxDocs` 조정 후 재시도

---

## 9) 추천 프리셋 요약

- 빠른 탐색: `scope: topic`, `maxDocs: 8`, `maxCharsPerDoc: 700`, `compressionMode: aggressive`
- 균형형 정리: `scope: all`, `maxDocs: 20`, `maxCharsPerDoc: 1200`, `memoryMode: both`, `compressionMode: balanced`
- 장문 순회: `scope: all`, `maxDocs: 10`, `maxCharsPerDoc: 900`, `maxOutputChars: 2800`

---

## 10) 운영 팁

- 첫 호출은 보수적으로 작은 `maxDocs`로 시작하고 `has_more`로 진행 속도/정밀도 조절
- `cache.hit`이 자주 true면 같은 조건 반복 조회가 최적화되는 환경
- 장시간 문맥 정제는 `collect_context`로 한 번에 끝내지 말고, 배치 단위 + `load_memory` 재주입으로 단계적으로 진행

---

## 11) 관련 파일

- `src/tools/vault/utils/actions/collect_context.ts` (구현)
- `src/tools/vault/types/collect_context.ts` (스키마/타입)
- `src/tools/vault/utils/actions/load_memory.ts` (저장본 복원)
- `src/tools/vault/utils/shared.ts` (`compression`, 출력 제약, 해시 보조 함수)
