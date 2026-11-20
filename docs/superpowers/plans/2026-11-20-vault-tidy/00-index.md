# Vault 정리 플러그인: 병렬 구현 계획 목차

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md`

이 폴더의 문서 하나가 작업 단위 하나다. 각 문서는 혼자 읽어도 구현할 수 있게 썼다. 다른 단위에서 받는 것과 넘기는 것은 각 문서의 **Interfaces**에 적혀 있고, 그 기준은 모두 `P0-contracts.md`의 계약이다.

## 실행 순서

| 묶음 | 동시에 진행하는 단위 | 시작 조건 |
|---|---|---|
| 1 | [P0 계약](P0-contracts.md), [T0 테스트용 Vault](T0-fixture-vault.md) | 없음 |
| 2 | [A1 스캐너](A1-scanner.md), [A2 링크 해석기](A2-link-resolver.md), [B1 첨부](B1-attachments-planner.md), [B2 중복](B2-duplicates-planner.md), [B3 무제](B3-untitled-planner.md), [B4 빈 폴더](B4-empty-folders-planner.md), [D 플러그인](D-plugin.md), [E1 CLI 제거](E1-remove-cli.md), [E2 메모리 쓰기 제거](E2-remove-memory-writes.md), [E3 프롬프트 도구 이전](E3-move-property-prompts.md) | P0 병합. A1, A2는 T0도 병합된 뒤 |
| 3 | [A3 계획 실행기](A3-plan-executor.md), [C1 tidy_plan 도구](C1-tidy-plan-tool.md) | A1, A2 병합. C1은 B1~B4도 병합된 뒤 |
| 4 | [C2 apply/undo 도구](C2-plan-apply-undo-tools.md) | A3 병합 |
| 5 | [I 통합 검증](I-integration.md) | C1, C2, D 병합 |
| 6 | [E4 organize_attachments 제거](E4-remove-organize-attachments.md) | I 통과 |

```
P0 ─┬─► A1 ─┐
T0 ─┤   A2 ─┼─► A3 ─► C2 ─┐
    ├─► B1~B4 ──► C1 ─────┼─► I ─► E4
    ├─► D ────────────────┘
    └─► E1, E2, E3
```

## 브랜치

- `main`에서 `vault-tidy/base`를 만든다. P0, T0를 여기에 병합한다.
- 각 단위는 `vault-tidy/base`에서 `vault-tidy/<단위 id 소문자>` 브랜치를 만든다(예: `vault-tidy/a2`).
- 병합 대상은 `vault-tidy/base`다. 모든 단위가 끝나면 `vault-tidy/base`를 `main`으로 보낸다.

## 파일 소유권

병렬 작업의 충돌을 막기 위해 파일마다 담당 단위를 정했다. 다른 단위의 파일은 고치지 않는다.

| 파일 | 담당 | 비고 |
|---|---|---|
| `src/shared/vault-ops/types.ts`, `ids.ts`, `graph.ts`, `planStore.ts`, `journal.ts`, `index.ts` | P0 | P0 이후 수정 금지. 바꿔야 하면 P0 문서를 먼저 고치고 모든 담당자에게 알린다 |
| `src/shared/vault-ops/boundary.ts` | P0(`topFolderOf`), A3(`checkMoveBoundary`) | |
| `src/shared/vault-ops/scan.ts` | A1 | P0가 시그니처만 둔다 |
| `src/shared/vault-ops/links.ts` | A2 | P0가 시그니처만 둔다 |
| `src/shared/vault-ops/apply.ts` | A3 | P0가 시그니처만 둔다 |
| `src/shared/mcp/toolResult.ts` | P0 | |
| `tests/helpers/vaultOps.ts` | P0 | |
| `tests/fixtures/messy-vault/**`, `tests/helpers/fixture.ts` | T0 | |
| `src/tools/tidy/planners/<name>.ts` | B1~B4 각각 | |
| `src/tools/tidy/` 나머지 | C1 | |
| `src/tools/plan/**` | C2 | |
| `src/tools/index.ts`의 `toolsWithDeps` 배열 | C1, C2가 한 줄씩 추가 | 충돌 시 두 줄 모두 남긴다 |
| `src/tools/index.ts`의 기존 `tools` 객체 | E3, E4가 자기 항목만 삭제 | |
| `src/server.ts` | P0 | E1~E4는 서버 안내문에서 자기가 지우는 도구나 설정의 줄만 지운다 |
| `plugin/**` | D | |

## 모든 단위에 공통인 제약

- TypeScript ESM이다. 상대 import에는 `.js` 확장자를 붙이고, shared는 `@shared/*`로 import한다.
- 코드에 주석을 쓰지 않는다. 예외는 `biome-ignore`, `@ts-expect-error`뿐이고 이유를 한 줄 붙인다.
- `src/shared/`는 `src/utils/`, `src/tools/`, `src/config.ts`를 import하지 않는다. 기능 폴더(`src/tools/<x>/`)는 자기 폴더, `@shared/*`, 외부 패키지만 import한다.
- Vault 안 경로는 Vault 루트 기준 상대 경로이고 구분자는 `/`다. 경로 비교는 `normalize("NFC").toLowerCase()`로 한다. macOS가 한글 파일명을 NFD로 돌려줄 수 있기 때문이다.
- 테스트는 `tests/unit/`에 둔다. 단일 실행은 `npx vitest run tests/unit/<Name>.test.ts`다.
- 단위 완료 조건은 해당 테스트 통과, `npm run build` 성공, `npm run check` 이후 변경 없음이다.
- 커밋 메시지는 저장소 형식(`feat(scope): 한국어 설명`)을 따르고 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.
- 테스트가 실제 파일을 만들면 `os.tmpdir()` 아래 임시 폴더를 쓰고 `afterEach`에서 지운다. `tests/fixtures/messy-vault/`는 읽기만 하고, 쓰는 테스트는 임시 폴더에 복사해서 쓴다(`fs.cp(src, dst, { recursive: true })`).
