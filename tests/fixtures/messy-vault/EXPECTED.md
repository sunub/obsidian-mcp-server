# messy-vault 기대 결과표

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
