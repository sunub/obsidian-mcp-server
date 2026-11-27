# MCP 서버 → 플러그인 전환 분석 문서

이 디렉터리는 `obsidian-mcp-server`를 단일 MCP 서버에서 **MCP + Skill + Command + Hook** 구조의 플러그인(`vault-tidy`)으로 전환하면서 도출한 현재 상태 진단과 기능 재배치 기준을 주제별로 분리해 정리한 문서 모음입니다.

기준 시점: 2026-11-27 (`0.4.0` 배포 이후)

## 1. 왜 전환하는가

기존 MCP 서버 단독 구조에는 세 가지 구조적 한계가 있었습니다.

1. **절차와 판단 기준 부재**: MCP는 도구 입출력만 정의할 뿐 승인 흐름, 네이밍 규칙, frontmatter 작성 기준을 강제할 수 없어 도구 `description`과 응답 본문에 프롬프트 지시문을 끼워 넣는 우회가 누적됐습니다.
2. **안전 경계 부재**: MCP 도구를 제공해도 에이전트가 셸(`mv`, `rm`)로 Vault 파일을 직접 건드려 Obsidian 링크를 깨는 것을 막지 못했습니다.
3. **도구별 중복 구현과 부작용**: 과거 도구(`organize_attachments`, `collect_context`)가 이동·링크 갱신·파일 쓰기를 각자 처리하면서 링크 누락, 되돌리기 불가, Vault 내 `memory/` 부산물 생성 문제가 발생했습니다.

## 2. 계층별 역할 분리 기준

| 계층 | 담당 책임 | 이 계층에 두는 이유 |
|---|---|---|
| **MCP Tool** | 파일 스캔, 해시/경계 검증, 링크 재작성, 저널 기반 `undo`, 로컬 검색 인덱스, frontmatter 안전한 쓰기 | 같은 입력에 항상 같은 결과를 보장해야 하는 결정론적 실행과 상태 관리 |
| **Skill** | 정리 절차, 승인 표 형식, 무제 노트 제목 규칙, frontmatter 스키마, 검색 결과 해석 | LLM 추론과 사용자 규칙이 개입하는 영역. 자연어 의도에 따라 활성화 |
| **Command** | `/vault-tidy:tidy`, `/vault-tidy:undo`, `/vault-tidy:status`, `/vault-tidy:reindex` (`/vault-context`는 보류) | 대규모 변경, 즉시 복구, 무거운 운영 작업의 의도적 진입점 |
| **Hook** | Vault 경로에 대한 직접 파일 조작 차단 | 프롬프트 지시만으로 막을 수 없는 에이전트의 우회 실행을 시스템 레벨에서 차단 |

## 3. 분리된 문서 목록

- [mcp-core.md](./mcp-core.md): MCP로 남겨야 하는 기능, `src/tools/`·`src/server.ts` 리팩터링 대상, 미결 설계 포인트
- [skills.md](./skills.md): Skill로 분리해야 하는 절차·판단 규칙(`vault-tidy`, `vault-frontmatter`)과 보류한 `vault-context`
- [commands.md](./commands.md): `plugin/commands/`에 제공할 명시적 슬래시 커맨드 명세
- [hooks-and-packaging.md](./hooks-and-packaging.md): Hook 사각지대 보강, 플러그인 배포·환경변수 설정, 표기 통일 및 잔여물 정리

## 4. 권장 진행 순서

1. **1단계 플러그인 마감**: 커맨드, Hook 보강, `${VAULT_DIR_PATH}` 검증, `0.4.0` 배포를 끝냈습니다. 커맨드를 대화형 세션에서 실행해 확인한 기록은 없습니다
2. **MCP/Skill 경계 정리**: `vault` 모놀리스 분해, 의존성 주입 통일. `collect_context`는 제거했고 `search`의 이어 받기는 정하지 않았습니다([검토 기록](../collect-context-review.md))
3. **2·3단계 진입**: `vault-frontmatter` Skill + 속성 조회 도구 구현
