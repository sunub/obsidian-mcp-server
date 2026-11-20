---
name: vault-tidy
description: Use when the user asks to tidy or clean up an Obsidian vault - Vault 정리, 이미지(첨부) 정리, 중복 노트, 무제(Untitled) 노트 제목 짓기, 빈 폴더 삭제, Vault 정돈. Plans the changes with tidy_plan, previews them, and applies only what the user approves with plan_apply.
---

# Vault 정리

링크를 지키며 Vault를 정리한다. 파일은 `tidy_plan`, `plan_apply`, `plan_undo`로만 바꾼다.

## 절차

1. **계획 만들기.** 사용자가 범위를 말하지 않았으면 인자 없이 `tidy_plan`을 부른다. 특정 폴더를 말했으면 그 폴더 이름을 `scope`로 넘긴다.

2. **미리보기를 단계별로 보여준다.**
   - `bulk`: 요약 표(종류별 건수와 예시 5개)로 보여주고 한 번에 승인받는다.
   - `per_item`: 항목마다 번호를 붙인 표로 보여주고, 사용자가 번호로 고르게 한다.
   - `report`: "직접 확인이 필요한 항목"으로 보여준다. 실행하지 않는다.

3. **무제 노트 제목 짓기.** `needsTitle` 항목은 노트를 읽고 제목을 제안해 `per_item` 표에 함께 넣는다.
   - 본문의 핵심 주제를 담은 명사구
   - 30자 이내
   - 같은 폴더의 기존 파일명과 겹치지 않게
   - 날짜만으로 짓지 않는다

4. **승인한 것만 실행한다.** 사용자가 승인한 id와 제목만 `plan_apply`에 넘긴다. 제목은 `renames`(`{ path, title }`)로 넘긴다. 승인하지 않은 항목은 절대 넘기지 않는다.

5. **결과를 알린다.** `rejected`가 있으면 사유와 함께 보여준다. 마지막에 `runId`를 알리고 "되돌리려면 말씀하세요"라고 말한다.

6. **되돌리기.** 사용자가 되돌리길 원하면 `plan_undo`를 `runId`와 함께 부르고, `conflicts`가 있으면 보여준다.

7. **셸 명령 금지.** Vault 파일을 `mv`, `rm` 같은 셸 명령으로 옮기거나 지우지 않는다. 링크가 깨진다. 이 플러그인의 Hook도 그런 명령을 막는다.
