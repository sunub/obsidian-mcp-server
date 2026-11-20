# T0. 테스트용 Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자 Vault에서 발견된 문제를 모두 담은 작은 가짜 Vault와, 사례별 기대 결과표를 만든다.

**Architecture:** `tests/fixtures/messy-vault/`에 실제 파일로 둔다. 코드는 없다. A1, A2, A3, C1, I가 이 폴더를 입력으로 쓴다.

**Tech Stack:** Markdown, 1×1 PNG

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (2장, 7.2 T0)

## Global Constraints

- `00-index.md`의 공통 제약을 따른다.
- 개인 정보가 들어간 실제 노트 내용은 넣지 않는다. 본문은 주제를 짐작할 수 있는 짧은 가짜 문장으로 쓴다.
- 이미지는 1×1 PNG를 쓴다. "같은 내용"이어야 하는 이미지는 바이트까지 같게 복사하고, "다른 내용"이어야 하는 이미지는 픽셀 색을 다르게 한다.

## Review Focus

- 파일명이 NFD로 저장된 한글 노트: `스터디/세션.md`를 NFD 파일명으로 만든다. A1, A2가 이 파일을 NFC 링크와 연결해야 한다.
- 코드 블록 안의 링크 모양 문자열: 바뀌면 안 된다.
- 이미 깨져 있는 링크: 정리 후에도 깨진 상태 그대로 남고, 깨진 링크 수에 새로 더해지지 않는다.

---

### Task 1: 폴더와 파일 생성

**Files:**
- Create: `tests/fixtures/messy-vault/**`

- [ ] **Step 1: 아래 트리를 만든다.** 오른쪽은 그 파일이 담아야 할 내용이다.

```
messy-vault/
├── .obsidian/app.json                         {} (스캔 제외 확인용)
├── Docker.md                                  ![[database.png]], [[무제 1]]
├── database.png                               루트 이미지, Docker.md만 참조
├── orphan.png                                 아무도 참조하지 않음
├── 무제.md                                     빈 파일
├── images/
│   └── 좋은코드/
│       └── 1.png                              좋은코드/좋은코드-Base.md가 ![[images/좋은코드/1.png]]로 참조
├── 좋은코드/
│   ├── 좋은코드-Base.md                        위 이미지 참조, [[자기소개서]] 링크(모호)
│   └── 무제.md                                 frontmatter만 있음 (---\ntags: []\n---\n)
├── 스터디/
│   ├── HTTP.md                                "HTTP는 요청-응답 프로토콜이다." (1주차/HTTP.md와 바이트 동일)
│   ├── HTTP Methods.md                        1주차 것과 내용 다름
│   ├── 세션.md                                 NFD 파일명, 본문 "세션 정리"
│   ├── shared.png                             스터디/HTTP.md, 스터디/1주차/HTTP.md(같은 내용이라 둘 다 ![[shared.png]] 포함), AI/LLM.md가 참조 (최상위 폴더 다름)
│   ├── Pasted image 1.png                     5주차/Pasted image 1.png와 바이트 동일
│   ├── 첨부파일/
│   │   └── methods.jpeg                       HTTP Methods.md가 ![[methods.jpeg|300]]로 참조
│   ├── 1주차/
│   │   ├── HTTP.md                            스터디/HTTP.md와 동일
│   │   └── HTTP Methods.md                    다른 내용
│   ├── 5주차/
│   │   ├── CORS.md                            ![[스터디/Pasted image 1.png]], ![캡처](캡처%20화면.png)
│   │   ├── 캡처 화면.png                       CORS.md가 마크다운 링크(공백 %20 인코딩)로 참조
│   │   ├── Pasted image 1.png                 스터디/Pasted image 1.png와 동일
│   │   └── 무제 2.md                           "CORS는 출처가 다른 요청을 허용하는 규칙이다." (내용 있는 무제)
│   └── 빈폴더/                                 비어 있음
├── AI/
│   ├── LLM.md                                 ![[shared.png]], [[세션]] (NFC로 입력)
│   ├── RAG.md                                 [[LLM#개요|LLM 개요]] 링크, ```코드 블록 안에 [[가짜링크]]```
│   ├── 빅분기/
│   │   ├── 빅분기-데이터.md                     ![[Pasted image 20260829123734.png]]
│   │   └── Pasted image 20260829123734.png    노트 옆에 섞인 이미지
│   └── 무제/                                   비어 있는 하위 폴더 안에 빈 하위 폴더 하나(무제/안쪽/)
├── resume/
│   ├── 자기소개서.md                            "resume 버전"
│   └── 무제 1.md                               빈 파일, 하지만 Docker.md가 [[무제 1]]로 링크
├── sunub/
│   ├── 이력서/
│   │   └── 자기소개서.md                        "sunub 버전"
│   └── 블로그/
│       ├── EventLoop.md                       ![[eventloop1.png]], [[없는노트]] (이미 깨진 링크)
│       └── eventloop1.png
└── 빈최상위/                                    비어 있는 최상위 폴더
```

빈 폴더는 git이 추적하지 않으므로 각 빈 폴더 안에 `.gitkeep`을 두되, 스캐너는 점으로 시작하는 파일을 무시한다(A1에서 처리).

- [ ] **Step 2: Commit** — `test(fixture): Vault 정리 테스트용 messy-vault 추가`

### Task 2: 기대 결과표

**Files:**
- Create: `tests/fixtures/messy-vault/EXPECTED.md`

- [ ] **Step 1: 아래 표를 기록한다.** 각 단위의 테스트는 이 표를 근거로 기댓값을 쓴다.

| 사례 | 담당 | 기대 결과 |
|---|---|---|
| `.obsidian/`, `.gitkeep` | A1 | 스냅샷에 없음 |
| 빈 폴더 `스터디/빈폴더`, `AI/무제`(안쪽 포함), `빈최상위` | A1 | `emptyFolders`에 `스터디/빈폴더`, `AI/무제`, `AI/무제/안쪽`, `빈최상위` |
| `[[세션]]` → NFD 파일 | A2 | 해석됨, 모호하지 않음 |
| `[[자기소개서]]` from `좋은코드/좋은코드-Base.md` | A2 | 모호함 true |
| `[[LLM#개요\|LLM 개요]]` | A2 | target `LLM`, suffix `#개요\|LLM 개요` |
| ` ```[[가짜링크]]``` ` | A2 | 파싱되지 않음 |
| `![캡처](캡처%20화면.png)` | A2 | `스터디/5주차/캡처 화면.png`로 해석 |
| `[[없는노트]]` | A2 | resolved null |
| `database.png` | B1 | `attachments/database.png`로 이동(bulk) |
| `images/좋은코드/1.png` | B1 | `좋은코드/attachments/1.png`로 이동(bulk) |
| `스터디/첨부파일/methods.jpeg` | B1 | `스터디/attachments/methods.jpeg`로 이동(bulk), 링크 `\|300` 유지 |
| `AI/빅분기/Pasted image 20260829123734.png` | B1 | `AI/빅분기/attachments/`로 이동(bulk) |
| `스터디/shared.png` | B1 | report(서로 다른 최상위 폴더) |
| `orphan.png` | B1 | report(참조 없음) |
| `스터디/HTTP.md`, `스터디/1주차/HTTP.md` | B2 | 둘 다 참조 0개 → 더 깊은 1주차 쪽 유지, `스터디/HTTP.md` trash(per_item), redirectTo `스터디/1주차/HTTP.md` |
| `Pasted image 1.png` 두 개 | B2 | 참조가 있는 `스터디/Pasted image 1.png` 유지(얕아도 참조 수가 우선), `스터디/5주차/Pasted image 1.png` trash |
| `스터디/Pasted image 1.png` | B1 | `스터디/5주차/attachments/`로 이동(bulk). 참조하는 노트가 5주차/CORS.md |
| `스터디/5주차/캡처 화면.png` | B1 | `스터디/5주차/attachments/`로 이동, CORS.md의 링크는 `attachments/캡처%20화면.png` |
| `sunub/블로그/eventloop1.png` | B1 | `sunub/블로그/attachments/`로 이동 |
| `HTTP Methods.md` 두 개 | B2 | report(이름 같고 내용 다름) |
| `자기소개서.md` 두 개 | B2 | report |
| 루트 `무제.md` | B3 | trash(per_item) |
| `좋은코드/무제.md` | B3 | trash(per_item) |
| `resume/무제 1.md` | B3 | report(비었지만 링크 있음) |
| `스터디/5주차/무제 2.md` | B3 | needsTitle |
| `스터디/빈폴더`, `AI/무제` | B4 | removeEmptyFolder(bulk). `AI/무제/안쪽`은 따로 만들지 않음 |
| `빈최상위` | B4 | report |
| 전체 실행 후 | A3, I | 깨진 링크는 `[[없는노트]]` 1개뿐, 되돌리면 모든 파일 해시 원상복구 |

- [ ] **Step 2: Commit** — `test(fixture): messy-vault 기대 결과표 추가`

### Task 3: fixture 복사 도우미

**Files:**
- Create: `tests/helpers/fixture.ts`
- Test: `tests/unit/FixtureHelper.test.ts`

**Interfaces:**
- Produces: `copyFixture(): Promise<string>` — `tests/fixtures/messy-vault/`를 `os.tmpdir()` 아래 새 폴더로 복사하고(`EXPECTED.md` 제외, `.gitkeep` 포함) 그 절대 경로를 돌려준다. `cleanupFixtures(): Promise<void>` — 이 도우미가 만든 폴더를 모두 지운다. A1, A2, A3, C1, C2, I가 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성** — 복사본에 `Docker.md`가 있고 `EXPECTED.md`가 없으며, 두 번 호출하면 경로가 다르다.
- [ ] **Step 2: 실패 확인** — `npx vitest run tests/unit/FixtureHelper.test.ts` → FAIL
- [ ] **Step 3: 구현** — `fs.mkdtemp`와 `fs.cp(..., { recursive: true, filter })`
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `test(fixture): fixture 복사 도우미 추가`
