# A2. 링크 해석기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 노트의 링크를 파싱하고 Obsidian 방식으로 해석해 `LinkGraph`를 만들고, 파일이 옮겨진 뒤 링크를 다시 쓸 대상 문자열을 계산한다.

**Architecture:** `src/shared/vault-ops/links.ts` 한 파일이다. 순수 함수 다섯 개로 이루어지며, 파일 읽기는 `buildLinkGraph`가 인자로 받은 `readNote`로만 한다. A3의 "링크 해석 보존" 규칙이 이 함수들에 기대므로 1단계에서 가장 중요한 단위다.

**Tech Stack:** `node:path/posix`

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (6.4 링크 재작성, 7.2 A2)

## Global Constraints

`00-index.md`의 공통 제약을 따른다. 경로 비교는 `pathKey`(P0 `graph.ts`)로 한다.

## Review Focus

- 코드 블록(```` ``` ````, `~~~`)과 인라인 코드 안의 링크 모양 문자열: 파싱하지 않는다. Task 1의 테스트가 다룬다.
- 외부 URL(`https://`, `mailto:`)과 `#앵커`만 있는 마크다운 링크: 파싱하지 않는다. Task 1의 테스트가 다룬다.
- 마크다운 링크의 잘못된 퍼센트 인코딩(`%E0`): 예외 없이 원문 그대로 대상으로 쓴다. Task 2의 테스트가 다룬다.
- 한 줄에 같은 링크가 여러 번 있는 경우: 각각 다른 `start`/`end`를 갖는다. Task 1의 테스트가 다룬다.
- 대소문자만 다른 링크(`[[http]]`): Obsidian처럼 해석된다. Task 2의 테스트가 다룬다.

---

### Task 1: `parseLinks`

**Files:**
- Modify: `src/shared/vault-ops/links.ts`
- Test: `tests/unit/VaultLinksParse.test.ts`

**Interfaces:**
- Consumes: `ParsedLink`, `LinkForm` (P0)
- Produces: `parseLinks(from: string, content: string): ParsedLink[]` — 원문 순서대로. `content.slice(start, end) === raw`.

형태별 규칙:

| 형태 | 모양 | target | suffix |
|---|---|---|---|
| `wiki` | `[[대상#제목\|별칭]]` | 첫 `#`, `^`, `\|` 앞 | 그 기호부터 `]]` 앞까지 |
| `embed` | `![[대상\|300]]` | 위와 같음 | 위와 같음 |
| `markdown` | `[텍스트](대상#앵커)` | `(` 뒤부터 `#` 앞, `%`는 디코딩하지 않음 | `#앵커` |
| `markdown-embed` | `![대체](대상)` | 위와 같음 | 위와 같음 |

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("위키 링크의 제목과 별칭은 suffix로 분리된다", () => {
	const [l] = parseLinks("AI/RAG.md", "[[LLM#개요|LLM 개요]]");
	expect(l).toMatchObject({ form: "wiki", target: "LLM", suffix: "#개요|LLM 개요", start: 0 });
});
test("임베드 크기는 suffix다", () => {
	const [l] = parseLinks("a.md", "![[methods.jpeg|300]]");
	expect(l).toMatchObject({ form: "embed", target: "methods.jpeg", suffix: "|300" });
});
test("마크다운 이미지 링크는 인코딩된 대상을 그대로 둔다", () => {
	const [l] = parseLinks("a.md", "![캡처](캡처%20화면.png)");
	expect(l).toMatchObject({ form: "markdown-embed", target: "캡처%20화면.png", suffix: "" });
});
test("코드 블록과 인라인 코드 안은 파싱하지 않는다", () => {
	const md = "```\n[[가짜]]\n```\n~~~\n[[가짜2]]\n~~~\n`[[가짜3]]` [[진짜]]";
	expect(parseLinks("a.md", md).map((l) => l.target)).toEqual(["진짜"]);
});
test("외부 URL과 앵커 전용 링크는 파싱하지 않는다", () => {
	expect(parseLinks("a.md", "[x](https://a.b) [y](mailto:a@b) [z](#top)")).toEqual([]);
});
test("같은 링크가 두 번 나오면 위치가 다르다", () => {
	const ls = parseLinks("a.md", "[[A]] [[A]]");
	expect(ls.map((l) => l.start)).toEqual([0, 6]);
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/unit/VaultLinksParse.test.ts` → FAIL
- [ ] **Step 3: 구현.** 먼저 코드 블록과 인라인 코드 구간을 찾아 제외 구간 목록을 만들고, 정규식 매치 중 시작점이 제외 구간에 있는 것을 버린다. 스킴 판정은 `/^[a-z][a-z0-9+.-]*:/i`다.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(vault-ops): 링크 파서 구현`

### Task 2: `resolveTarget`과 `buildLinkGraph`

**Files:**
- Modify: `src/shared/vault-ops/links.ts`
- Test: `tests/unit/VaultLinksResolve.test.ts`

**Interfaces:**
- Consumes: `createLinkGraph`, `pathKey` (P0 `graph.ts`), `VaultSnapshot`
- Produces:
  - `resolveTarget(target: string, form: LinkForm, from: string, paths: readonly string[]): { resolved: string | null; ambiguous: boolean }` — `resolved`는 `paths` 안의 원래 문자열 그대로
  - `buildLinkGraph(snapshot: VaultSnapshot, readNote: (path: string) => Promise<string>): Promise<LinkGraph>` — `kind === "note"`인 파일만 읽는다

해석 규칙(Obsidian 동작을 따른다):

1. 대상에 확장자가 없으면 `.md`를 붙인다. 확장자 판정은 마지막 `.` 뒤가 `NOTE_EXTENSIONS` 또는 `ATTACHMENT_EXTENSIONS`, 또는 `.canvas`, `.base`인지로 한다. `[[note.v2]]`는 `note.v2.md`가 된다.
2. `markdown`, `markdown-embed`는 먼저 `decodeURIComponent`를 시도하고 실패하면 원문을 쓴다. 그다음 `posix.join(dirname(from), 대상)`이 있으면 그것, 없으면 앞의 `/`를 뗀 Vault 루트 기준 경로가 있으면 그것, 둘 다 없으면 3번 규칙으로 넘어간다.
3. 대상에 `/`가 있으면 `pathKey`가 대상과 같거나 `"/" + 대상`으로 끝나는 파일이 후보다. 없으면 파일명(`basename`)의 `pathKey`가 같은 파일이 후보다.
4. 후보가 하나면 그것(`ambiguous: false`). 여럿이면 `from`과 같은 폴더의 후보가 있으면 그것(`ambiguous: false`), 없으면 경로가 가장 짧은 후보(같으면 사전순 앞)를 고르고 `ambiguous: true`. 후보가 없으면 `{ resolved: null, ambiguous: false }`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
const paths = ["스터디/HTTP.md", "스터디/1주차/HTTP.md", "resume/자기소개서.md",
	"sunub/이력서/자기소개서.md", "스터디/세션.md".normalize("NFD"), "스터디/5주차/캡처 화면.png"];

test("유일한 파일명은 바로 해석된다", () => {
	expect(resolveTarget("세션", "wiki", "AI/LLM.md", paths)).toEqual({ resolved: paths[4], ambiguous: false });
});
test("같은 이름이 여럿이고 같은 폴더가 없으면 모호하다", () => {
	expect(resolveTarget("자기소개서", "wiki", "좋은코드/좋은코드-Base.md", paths))
		.toEqual({ resolved: "resume/자기소개서.md", ambiguous: true });
});
test("같은 폴더의 후보가 있으면 모호하지 않다", () => {
	expect(resolveTarget("HTTP", "wiki", "스터디/1주차/x.md", paths))
		.toEqual({ resolved: "스터디/1주차/HTTP.md", ambiguous: false });
});
test("대소문자가 달라도 해석된다", () => {
	expect(resolveTarget("http", "wiki", "스터디/x.md", paths).resolved).toBe("스터디/HTTP.md");
});
test("경로가 있는 대상은 경로 끝 일치로 찾는다", () => {
	expect(resolveTarget("1주차/HTTP", "wiki", "a.md", paths).resolved).toBe("스터디/1주차/HTTP.md");
});
test("마크다운 링크는 노트 기준 상대 경로를 먼저 본다", () => {
	expect(resolveTarget("캡처%20화면.png", "markdown-embed", "스터디/5주차/CORS.md", paths).resolved)
		.toBe("스터디/5주차/캡처 화면.png");
});
test("잘못된 퍼센트 인코딩은 예외 없이 원문으로 해석한다", () => {
	expect(resolveTarget("%E0.png", "markdown", "a.md", paths)).toEqual({ resolved: null, ambiguous: false });
});
test("fixture 전체 그래프의 깨진 링크는 [[없는노트]] 하나다", async () => {
	const root = await copyFixture();
	const snap = await scanVault(root);
	const graph = await buildLinkGraph(snap, (p) => fs.readFile(path.join(root, p), "utf-8"));
	expect(graph.refs.filter((r) => r.resolved === null).map((r) => r.target)).toEqual(["없는노트"]);
});
```

마지막 테스트는 A1(`scanVault`)과 T0(`copyFixture`)를 쓴다. A1 병합 전에는 이 테스트만 실패하는 것이 정상이고, A1 병합 후 통과해야 이 단위가 끝난다.

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(vault-ops): Obsidian 방식 링크 해석과 링크 그래프 구현`

### Task 3: `linkTargetFor`와 `rewriteLink`

**Files:**
- Modify: `src/shared/vault-ops/links.ts`
- Test: `tests/unit/VaultLinksRewrite.test.ts`

**Interfaces:**
- Produces:
  - `linkTargetFor(targetPath: string, from: string, form: LinkForm, paths: readonly string[]): string`
    - `wiki`, `embed`: 파일명(노트는 `.md`를 뗌)이 `resolveTarget`으로 `targetPath`에 모호하지 않게 해석되면 파일명, 아니면 Vault 루트 기준 전체 경로(노트는 `.md`를 뗌)
    - `markdown`, `markdown-embed`: `dirname(from)`에서 `targetPath`까지의 posix 상대 경로. 공백만 `%20`으로 바꾼다
  - `rewriteLink(link: ParsedLink, newTarget: string): string` — 형태와 suffix, 마크다운의 텍스트 부분을 유지하고 대상만 바꾼 새 원문

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("파일명이 유일하면 파일명만 쓴다", () => {
	expect(linkTargetFor("좋은코드/attachments/1.png", "좋은코드/좋은코드-Base.md", "embed",
		["좋은코드/attachments/1.png"])).toBe("1.png");
});
test("파일명이 모호하면 전체 경로를 쓰고 노트는 .md를 뗀다", () => {
	expect(linkTargetFor("sunub/이력서/자기소개서.md", "a.md", "wiki",
		["resume/자기소개서.md", "sunub/이력서/자기소개서.md"])).toBe("sunub/이력서/자기소개서");
});
test("마크다운 링크는 상대 경로에 공백만 인코딩한다", () => {
	expect(linkTargetFor("스터디/5주차/attachments/캡처 화면.png", "스터디/5주차/CORS.md", "markdown-embed", []))
		.toBe("attachments/캡처%20화면.png");
});
test("rewriteLink는 suffix와 텍스트를 유지한다", () => {
	const [w] = parseLinks("a.md", "![[methods.jpeg|300]]");
	expect(rewriteLink(w, "attachments/methods.jpeg")).toBe("![[attachments/methods.jpeg|300]]");
	const [m] = parseLinks("a.md", "[설명 텍스트](old.md#앵커)");
	expect(rewriteLink(m, "new.md")).toBe("[설명 텍스트](new.md#앵커)");
});
test("다시 쓴 링크를 다시 파싱하면 같은 대상으로 해석된다", () => {
	/* linkTargetFor → rewriteLink → parseLinks → resolveTarget 결과가 targetPath와 같음을
	   wiki, embed, markdown, markdown-embed 네 형태에 대해 확인 */
});
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(vault-ops): 링크 재작성 구현`
