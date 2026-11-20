# A1. Vault 스캐너 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vault의 모든 파일을 걷고 종류, 크기, 해시, 빈 폴더를 계산해 `VaultSnapshot`을 만든다.

**Architecture:** `src/shared/vault-ops/scan.ts` 한 파일이다. P0가 둔 미구현 시그니처를 채운다. 기존 `src/utils/DirectoryWalker.ts`는 `.md`만 보므로 쓰지 않는다.

**Tech Stack:** `node:fs/promises`, `node:crypto`(sha256)

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (7.2 A1)

## Global Constraints

`00-index.md`의 공통 제약을 따른다. 입력은 `tests/fixtures/messy-vault/`와 `EXPECTED.md`다.

## Review Focus

- NFD 파일명: `path`는 디스크에 있는 그대로 둔다(정규화하지 않는다). 비교는 소비하는 쪽이 `pathKey`로 한다. Task 1의 테스트가 다룬다.
- 심볼릭 링크: 따라가지 않고 건너뛴다. Vault 밖을 가리킬 수 있기 때문이다. Task 1의 테스트가 다룬다.
- 읽기 권한이 없는 파일: 스캔 전체가 실패하지 않고 그 파일만 빠진다. Task 1의 테스트가 다룬다.

---

### Task 1: `classifyFile`과 `scanVault`

**Files:**
- Modify: `src/shared/vault-ops/scan.ts`
- Test: `tests/unit/VaultScan.test.ts`

**Interfaces:**
- Consumes: `copyFixture(): Promise<string>` (T0 `tests/helpers/fixture.ts`), `VaultFile`, `VaultSnapshot`, `FileKind`, `EXCLUDED_DIRS`, `NOTE_EXTENSIONS`, `ATTACHMENT_EXTENSIONS` (P0 `types.ts`)
- Produces:
  - `classifyFile(path: string): FileKind` — 확장자(소문자)가 `NOTE_EXTENSIONS`면 `"note"`, `ATTACHMENT_EXTENSIONS`면 `"attachment"`, 그 밖은 `"other"`
  - `scanVault(root: string): Promise<VaultSnapshot>` — `files`는 `path` 오름차순, `folders`와 `emptyFolders`도 오름차순. `root`는 인자 그대로.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
const FIXTURE = path.join(process.cwd(), "tests/fixtures/messy-vault");

test("classifyFile은 확장자로 종류를 정한다", () => {
	expect(classifyFile("a/b.md")).toBe("note");
	expect(classifyFile("a/B.PNG")).toBe("attachment");
	expect(classifyFile("a/c.canvas")).toBe("other");
});

test("제외 폴더와 점으로 시작하는 파일은 스냅샷에 없다", async () => {
	const snap = await scanVault(FIXTURE);
	expect(snap.files.some((f) => f.path.startsWith(".obsidian/"))).toBe(false);
	expect(snap.files.some((f) => f.path.endsWith(".gitkeep"))).toBe(false);
	expect(snap.files.some((f) => f.path === "EXPECTED.md")).toBe(false);
});

test("빈 폴더는 하위에 파일이 하나도 없는 폴더 전부다", async () => {
	const snap = await scanVault(FIXTURE);
	expect(snap.emptyFolders).toEqual(["AI/무제", "AI/무제/안쪽", "빈최상위", "스터디/빈폴더"].sort());
});

test("바이트가 같은 파일은 해시가 같다", async () => {
	const snap = await scanVault(FIXTURE);
	const h = (p: string) => snap.files.find((f) => f.path === p)?.hash;
	expect(h("스터디/HTTP.md")).toBe(h("스터디/1주차/HTTP.md"));
	expect(h("스터디/HTTP Methods.md")).not.toBe(h("스터디/1주차/HTTP Methods.md"));
});

test("NFD 파일명은 디스크의 형태 그대로 담긴다", async () => {
	const snap = await scanVault(FIXTURE);
	const session = snap.files.find((f) => f.path.normalize("NFC") === "스터디/세션.md");
	expect(session).toBeDefined();
});

test("심볼릭 링크는 건너뛴다", async () => { /* tmp vault에 symlink 생성 후 files에 없음 */ });
test("읽을 수 없는 파일은 건너뛰고 나머지는 스캔한다", async () => { /* tmp vault에 chmod 000 파일, root 권한이면 test.skip */ });
```

`scanVault`는 `EXPECTED.md`를 특별 취급하지 않는다. 테스트는 `FIXTURE` 대신 T0의 `copyFixture()`가 만든 복사본(`EXPECTED.md` 제외)에 실행한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/VaultScan.test.ts`
Expected: FAIL ("not implemented")

- [ ] **Step 3: 구현.** `readdir(dir, { withFileTypes: true })`로 재귀 탐색한다. 이름이 `.`으로 시작하는 항목과 `EXCLUDED_DIRS`는 건너뛴다. `isSymbolicLink()`이면 건너뛴다. 해시는 `createHash("sha256")`에 파일 내용을 넣은 hex다. 파일을 읽다 실패하면 그 파일만 빠진다. `emptyFolders`는 하위 트리에 스냅샷 파일이 하나도 없는 폴더다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/unit/VaultScan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit** — `feat(vault-ops): Vault 스캐너 구현`
