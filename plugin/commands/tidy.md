---
description: Obsidian Vault 전체 또는 특정 최상위 폴더의 정리 계획을 만들고 승인된 항목만 적용한다
argument-hint: "[scope]"
disable-model-invocation: true
---

# Vault 정리 시작

`vault-tidy` 스킬의 절차에 따라 Obsidian Vault 정리를 시작한다.

## 인자 처리

- 전달된 인자: `$ARGUMENTS`
- 인자가 비어 있으면 `tidy_plan`을 인자 없이 호출해 전체 Vault를 스캔한다.
- 인자가 있으면 앞뒤 공백을 제거한 값을 최상위 폴더 이름(`scope`)으로 `tidy_plan`에 넘긴다.

## 실행 규칙

1. `tidy_plan` 결과를 `bulk` / `per_item` / `report` 티어로 나누어 미리보기를 보여준다.
2. `needsTitle` 무제 노트는 본문을 읽고 `vault-tidy` 스킬의 제목 규칙에 맞춰 제목을 제안한다.
3. 사용자가 명시적으로 승인한 `approvedOpIds`와 `renames`만 `plan_apply`에 넘긴다. 승인하지 않은 항목은 절대 넘기지 않는다.
4. 완료 후 `rejected` 사유와 `runId`를 출력하고, 되돌리려면 `/vault-tidy:undo <runId>`를 실행하라고 안내한다.
5. Vault 파일을 `mv`, `rm` 같은 셸 명령으로 직접 옮기거나 삭제하지 않는다.
