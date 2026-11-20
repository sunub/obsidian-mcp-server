# E3. 프롬프트 모양 도구를 Skill 초안으로 옮기기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 디스크에 아무 일도 하지 않고 지시문만 돌려주는 `generate_property`, `create_document_with_properties`를 도구에서 빼고, 담고 있던 지시문을 3단계 frontmatter Skill의 초안 문서로 보존한다.

**Architecture:** 두 도구 폴더를 지운다. 실제로 frontmatter를 쓰는 `write_property`는 남긴다. 지시문(스키마, 사용 지침, 2단계 흐름)은 `docs/frontmatter-skill-draft.md`로 옮긴다.

**Tech Stack:** TypeScript, Markdown

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (7.2 E3, 8장 3단계)

## Global Constraints

`00-index.md`의 공통 제약을 따른다. `src/tools/index.ts`의 기존 `tools` 객체에서 두 항목만 지운다. `toolsWithDeps`는 건드리지 않는다.

## Review Focus

- `write_property` 설명문이 `generate_property`를 먼저 부르라고 안내하는 경우: 삭제 후 존재하지 않는 도구를 가리키게 된다. Task 1에서 설명문을 고친다.

---

### Task 1: 두 도구 제거와 초안 문서 작성

**Files:**
- Delete: `src/tools/generate_property/`, `src/tools/create_document_with_properties/`
- Modify: `src/tools/index.ts`, `src/server.ts`(안내문의 두 도구 줄만), `src/tools/write_property/index.ts`(설명문), `docs/tool-reference.md`, `docs/tools-usage-guide.md`, `docs/tool-call-flows.md`, README의 "제공 기능"
- Create: `docs/frontmatter-skill-draft.md`

- [ ] **Step 1:** `docs/frontmatter-skill-draft.md`를 쓴다. 두 도구의 `description`, `instructions`, `schema`(`title`, `tags`, `summary`, `slug`, `date`, `category`, `completed`), `ai_prompt`, 2단계 흐름을 그대로 옮기고, 맨 위에 "3단계에서 블로그 글과 일반 노트 규칙을 나눌 때의 출발점"이라고 한 줄 적는다.
- [ ] **Step 2:** 두 폴더를 지우고 `grep -rn "generate_property\|create_document_with_properties\|GenerateObsidianVaultPropertiesTool\|CreateDocumentWithPropertyTool" src tests docs README.md`의 사용처를 고친다. `docs/superpowers/`와 새 초안 문서는 그대로 둔다.
- [ ] **Step 3: 확인** — `npm run build && npm test -- --run` → 둘 다 성공
- [ ] **Step 4: Commit** — `refactor: 프롬프트만 돌려주던 속성 생성 도구를 제거하고 Skill 초안으로 보존`
