---
description: 이전 Vault 정리 실행(runId)을 원래 상태로 되돌린다
argument-hint: "[runId]"
disable-model-invocation: true
---

# Vault 정리 되돌리기

이전 `plan_apply` 실행 결과를 `plan_undo`로 원상 복구한다.

## 절차

- 전달된 인자: `$ARGUMENTS`

1. **`runId`가 전달된 경우**: 앞뒤 공백을 제거한 `runId`로 즉시 `plan_undo`를 호출한다.
2. **`runId`가 비어 있는 경우**:
   - 현재 대화에서 가장 최근에 실행된 `plan_apply`의 `runId`를 먼저 찾는다.
   - 대화에 없으면 Vault 루트 아래 `.vault-tidy/runs/*.json` 파일을 확인해 `undoneAt`이 `null`인 실행 중 `createdAt`이 가장 최근인 항목을 찾는다.
   - 찾은 `runId`, 실행 시각, 변경 건수를 사용자에게 보여주고 복원할지 확인받은 뒤 `plan_undo`를 호출한다.
   - 되돌릴 미복원 실행이 없으면 그 사실을 알리고 종료한다.
3. **결과 보고**:
   - 복원된 항목 수(`restored`)를 보고한다.
   - `conflicts`가 비어 있지 않으면, 실행 이후 사용자가 수정해 건너뛴 파일 경로와 사유를 명확히 목록으로 보고한다.
