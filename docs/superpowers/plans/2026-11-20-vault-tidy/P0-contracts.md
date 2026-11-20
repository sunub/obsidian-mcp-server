# P0. 계약 확정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다른 모든 단위가 동시에 시작할 수 있도록 공용 타입, 작은 공용 구현, 빈 시그니처, 테스트 도우미, 서버 연결 지점을 확정한다.

**Architecture:** `src/shared/vault-ops/`에 계약을 둔다. 구현이 몇 줄인 것(`ids`, `graph`, `topFolderOf`, `planStore`, `journal`)은 P0에서 끝낸다. 무거운 것(`scan`, `links`, `checkMoveBoundary`, `apply`)은 시그니처만 두고 `throw new Error("not implemented")`로 남겨, 담당 단위가 파일째 채운다.

**Tech Stack:** TypeScript 5.9 ESM, Vitest 3, `@modelcontextprotocol/sdk`, zod 3

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (6.3, 6.4)

## Global Constraints

`00-index.md`의 "모든 단위에 공통인 제약"을 따른다.

## Review Focus

- 계획 파일이나 실행 기록 JSON이 손상되었거나 없는 경우: `loadPlan`, `readJournal`은 예외 대신 `null`을 돌려준다. Task 3의 테스트가 다룬다.
- 루트에 있는 파일의 최상위 폴더: `topFolderOf("a.md")`는 `null`이다. Task 2의 테스트가 다룬다.
- 같은 밀리초에 두 계획이 만들어지는 경우: `newPlanId`가 겹치지 않는다. Task 2의 테스트가 다룬다.

---

### Task 1: 계약 타입과 상수

**Files:**
- Create: `src/shared/vault-ops/types.ts`

**Interfaces:**
- Produces: 아래 타입과 상수 전부. 모든 단위가 이 이름 그대로 쓴다.

- [ ] **Step 1: `src/shared/vault-ops/types.ts`를 아래 내용으로 만든다**

```ts
export type FileKind = "note" | "attachment" | "other";

export type VaultFile = {
	path: string;
	kind: FileKind;
	size: number;
	hash: string;
	mtimeMs: number;
};

export type VaultSnapshot = {
	root: string;
	files: VaultFile[];
	folders: string[];
	emptyFolders: string[];
};

export type LinkForm = "wiki" | "embed" | "markdown" | "markdown-embed";

export type ParsedLink = {
	from: string;
	raw: string;
	start: number;
	end: number;
	target: string;
	form: LinkForm;
	suffix: string;
};

export type LinkRef = ParsedLink & {
	resolved: string | null;
	ambiguous: boolean;
};

export interface LinkGraph {
	readonly refs: readonly LinkRef[];
	inbound(path: string): LinkRef[];
	outbound(path: string): LinkRef[];
}

export type RiskTier = "bulk" | "per_item" | "report";
export type ActionTier = Exclude<RiskTier, "report">;

export type MoveOp = {
	id: string;
	type: "move";
	from: string;
	to: string;
	tier: ActionTier;
	reason: string;
};

export type TrashOp = {
	id: string;
	type: "trash";
	path: string;
	redirectTo: string | null;
	tier: ActionTier;
	reason: string;
};

export type RemoveEmptyFolderOp = {
	id: string;
	type: "removeEmptyFolder";
	path: string;
	tier: ActionTier;
	reason: string;
};

export type ReportOp = {
	id: string;
	type: "report";
	paths: string[];
	tier: "report";
	reason: string;
};

export type PlanOp = MoveOp | TrashOp | RemoveEmptyFolderOp | ReportOp;

export type NeedsTitle = { path: string; preview: string };
export type TitleRename = { path: string; title: string };

export type ChangePlan = {
	planId: string;
	createdAt: string;
	source: string;
	scope: string | null;
	ops: PlanOp[];
	needsTitle: NeedsTitle[];
	fileHashes: Record<string, string>;
};

export type TidyOptions = {
	attachmentsFolderName: string;
	scope: string | null;
};

export const DEFAULT_TIDY_OPTIONS: TidyOptions = {
	attachmentsFolderName: "attachments",
	scope: null,
};

export type PlannerContext = {
	snapshot: VaultSnapshot;
	graph: LinkGraph;
	options: TidyOptions;
	readNote: (path: string) => Promise<string>;
};

export type PlannerOutput = { ops: PlanOp[]; needsTitle: NeedsTitle[] };
export type Planner = (ctx: PlannerContext) => Promise<PlannerOutput>;

export type ApplyRequest = {
	planId: string;
	approvedOpIds: string[];
	renames: TitleRename[];
};

export type ApplyResult = {
	runId: string;
	applied: string[];
	rejected: { opId: string; reason: string }[];
	rewrittenLinks: number;
	removedFolders: string[];
};

export type UndoResult = {
	runId: string;
	restored: number;
	conflicts: { path: string; reason: string }[];
};

export type JournalEntry =
	| { kind: "createFolder"; path: string }
	| { kind: "move"; from: string; to: string; hash: string }
	| { kind: "trash"; from: string; to: string; hash: string }
	| { kind: "rewrite"; path: string; before: string; afterHash: string }
	| { kind: "removeFolder"; path: string };

export type RunJournal = {
	runId: string;
	planId: string;
	createdAt: string;
	undoneAt: string | null;
	entries: JournalEntry[];
};

export type VaultToolDeps = { vaultRoot: () => string };

export const VAULT_TIDY_DIR = ".vault-tidy";
export const TRASH_DIR = ".trash";
export const EXCLUDED_DIRS: readonly string[] = [".obsidian", ".trash", ".vault-tidy", ".git"];
export const NOTE_EXTENSIONS: readonly string[] = [".md"];
export const ATTACHMENT_EXTENSIONS: readonly string[] = [
	".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".bmp", ".pdf",
	".mp3", ".mp4", ".mov", ".webm", ".wav",
];
```

필드 의미는 다음과 같다. `ParsedLink.target`은 접미사를 뺀 링크 대상 문자열이고, `suffix`는 위키 링크의 `#제목`, `^블록`, `|별칭`, `|300` 부분 전체(앞 기호 포함)다. 마크다운 링크에서는 `#앵커` 부분이다. `start`와 `end`는 원문에서 `raw`의 위치다. `ChangePlan.fileHashes`는 계획이 건드리는 모든 파일과, 그 파일을 링크하는 모든 노트의 계획 시점 해시다. `TrashOp.redirectTo`는 휴지통으로 보낸 파일을 가리키던 링크를 대신 가리킬 파일이다.

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 오류 없음

- [ ] **Step 3: Commit**

```bash
git add src/shared/vault-ops/types.ts
git commit -m "feat(vault-ops): Vault 정리 계약 타입 추가"
```

### Task 2: id 생성, 링크 그래프, 최상위 폴더 판정

**Files:**
- Create: `src/shared/vault-ops/ids.ts`, `src/shared/vault-ops/graph.ts`, `src/shared/vault-ops/boundary.ts`
- Test: `tests/unit/VaultOpsBasics.test.ts`

**Interfaces:**
- Produces:
  - `makeOpId(type: PlanOp["type"] | "rename", key: string): string` → `${type}:${key}`
  - `newPlanId(): string`, `newRunId(): string` → `YYYYMMDD-HHmmss-<6자리 base36 난수>`
  - `pathKey(path: string): string` → `path.normalize("NFC").toLowerCase()`
  - `createLinkGraph(refs: LinkRef[]): LinkGraph` — `inbound`은 `resolved`의 `pathKey`가 같은 ref, `outbound`는 `from`의 `pathKey`가 같은 ref를 돌려준다.
  - `topFolderOf(path: string): string | null` — 첫 경로 조각. 루트 파일이면 `null`.
  - `checkMoveBoundary(input: { from: string; to: string; kind: FileKind; referencingNotes: string[] }): string | null` — P0에서는 `throw new Error("not implemented")`. A3가 구현한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("makeOpId는 종류와 키를 콜론으로 잇는다", () => {
	expect(makeOpId("move", "a/b.png")).toBe("move:a/b.png");
});
test("newPlanId는 연속 호출해도 겹치지 않는다", () => {
	const ids = new Set(Array.from({ length: 1000 }, () => newPlanId()));
	expect(ids.size).toBe(1000);
});
test("topFolderOf는 첫 폴더를, 루트 파일이면 null을 돌려준다", () => {
	expect(topFolderOf("스터디/1주차/HTTP.md")).toBe("스터디");
	expect(topFolderOf("Docker.md")).toBeNull();
});
test("createLinkGraph는 NFD 경로도 같은 파일로 묶는다", () => {
	const nfd = "자기소개서.md".normalize("NFD");
	const graph = createLinkGraph([
		link("a.md", "자기소개서", nfd),
		link("b.md", "자기소개서", "자기소개서.md"),
	]);
	expect(graph.inbound("자기소개서.md")).toHaveLength(2);
	expect(graph.outbound("a.md")).toHaveLength(1);
});
```

`link`는 Task 4의 도우미다. Task 4를 먼저 하거나, 이 테스트 파일 안에 같은 모양의 객체를 직접 만든다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/unit/VaultOpsBasics.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 세 파일 구현.** 난수는 `crypto.randomBytes`를 쓴다. `boundary.ts`에는 `topFolderOf`와 미구현 `checkMoveBoundary`를 둔다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/unit/VaultOpsBasics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit** — `feat(vault-ops): id 생성, 링크 그래프, 최상위 폴더 판정 추가`

### Task 3: 계획 저장소와 실행 기록

**Files:**
- Create: `src/shared/vault-ops/planStore.ts`, `src/shared/vault-ops/journal.ts`
- Test: `tests/unit/VaultOpsStore.test.ts`

**Interfaces:**
- Produces:
  - `savePlan(root: string, plan: ChangePlan): Promise<void>` → `<root>/.vault-tidy/plans/<planId>.json`
  - `loadPlan(root: string, planId: string): Promise<ChangePlan | null>`
  - `writeJournal(root: string, journal: RunJournal): Promise<void>` → `<root>/.vault-tidy/runs/<runId>.json`. 임시 파일에 쓴 뒤 `rename`으로 바꿔 넣는다.
  - `readJournal(root: string, runId: string): Promise<RunJournal | null>`
  - `planId`, `runId`에 `/`, `\`, `..`이 들어 있으면 두 읽기 함수는 `null`, 두 쓰기 함수는 예외를 던진다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("저장한 계획을 그대로 읽는다", async () => { /* savePlan 후 loadPlan 결과가 toEqual */ });
test("없는 계획은 null", async () => { expect(await loadPlan(root, "nope")).toBeNull(); });
test("손상된 JSON은 null", async () => { /* 파일에 "{" 기록 후 loadPlan → null */ });
test("경로 탈출 id는 null", async () => { expect(await loadPlan(root, "../x")).toBeNull(); });
test("실행 기록을 덮어써도 마지막 내용이 남는다", async () => { /* writeJournal 두 번 → readJournal이 두 번째 */ });
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/unit/VaultOpsStore.test.ts` → FAIL
- [ ] **Step 3: 구현.** 폴더는 `mkdir({ recursive: true })`로 만든다.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(vault-ops): 계획 저장소와 실행 기록 추가`

### Task 4: 미구현 시그니처, 묶음 export, 도구 결과 도우미, 테스트 도우미

**Files:**
- Create: `src/shared/vault-ops/scan.ts`, `src/shared/vault-ops/links.ts`, `src/shared/vault-ops/apply.ts`, `src/shared/vault-ops/index.ts`, `src/shared/mcp/toolResult.ts`, `tests/helpers/vaultOps.ts`

**Interfaces:**
- Produces (P0에서는 모두 `throw new Error("not implemented")`):
  - `scan.ts`: `scanVault(root: string): Promise<VaultSnapshot>`, `classifyFile(path: string): FileKind`
  - `links.ts`: `parseLinks(from: string, content: string): ParsedLink[]`, `resolveTarget(target: string, form: LinkForm, from: string, paths: readonly string[]): { resolved: string | null; ambiguous: boolean }`, `buildLinkGraph(snapshot: VaultSnapshot, readNote: (path: string) => Promise<string>): Promise<LinkGraph>`, `linkTargetFor(targetPath: string, from: string, form: LinkForm, paths: readonly string[]): string`, `rewriteLink(link: ParsedLink, newTarget: string): string`
  - `apply.ts`: `applyPlan(root: string, request: ApplyRequest): Promise<ApplyResult>`, `undoRun(root: string, runId: string): Promise<UndoResult>`
- Produces (구현 완료):
  - `index.ts`: `types`, `ids`, `graph`, `boundary`, `planStore`, `journal`, `scan`, `links`, `apply`를 모두 다시 export
  - `src/shared/mcp/toolResult.ts`: `toolJson(data: unknown): CallToolResult` (JSON 문자열 하나를 text content로), `toolError(message: string, hint?: string): CallToolResult` (`isError: true`)
  - `tests/helpers/vaultOps.ts`:
    - `file(path: string, overrides?: Partial<VaultFile>): VaultFile` — 확장자로 `kind`를 정하고, `hash`는 기본값 `"h:" + path`, `size` 1, `mtimeMs` 0
    - `snapshotOf(files: VaultFile[], extra?: { emptyFolders?: string[] }): VaultSnapshot` — `root`는 `"/vault"`, `folders`는 파일 경로들의 모든 상위 폴더
    - `link(from: string, target: string, resolved: string | null, overrides?: Partial<LinkRef>): LinkRef` — 기본 `form` `"wiki"`, `raw` `[[target]]`, `suffix` `""`, `ambiguous` false, `start`/`end` 0
    - `notesReader(contents: Record<string, string>): (path: string) => Promise<string>`

- [ ] **Step 1: 파일 생성.** 미구현 함수는 매개변수 이름을 위 시그니처와 같게 두고, 쓰지 않는 매개변수 경고는 이름 앞에 `_`를 붙여 피한다.
- [ ] **Step 2: 빌드 확인** — `npm run build` → 오류 없음
- [ ] **Step 3: Commit** — `feat(vault-ops): 미구현 시그니처와 도구 결과, 테스트 도우미 추가`

### Task 5: 서버 연결 지점

**Files:**
- Modify: `src/tools/index.ts`, `src/server.ts`
- Test: `tests/server.test.ts`가 그대로 통과하는지만 확인

**Interfaces:**
- Produces:
  - `src/tools/index.ts`에 `export const toolsWithDeps: { register: (server: McpServer, deps: VaultToolDeps) => void }[] = [];`. C1과 C2가 여기에 한 줄씩 추가한다.
  - `src/server.ts`는 기존 `tools` 등록 뒤에 `const deps: VaultToolDeps = { vaultRoot: () => state.vaultPath };`를 만들고 `toolsWithDeps`를 돌며 `register(mcpServer, deps)`를 호출한다. `state`는 `./config.js`의 기본 export다.

- [ ] **Step 1: 두 파일 수정**
- [ ] **Step 2: 확인** — `npm run build && npx vitest run tests/server.test.ts` → 둘 다 성공
- [ ] **Step 3: Commit** — `feat(server): 의존성을 받는 도구 등록 지점 추가`
