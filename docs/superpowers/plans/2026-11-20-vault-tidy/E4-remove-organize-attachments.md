# E4. `organize_attachments` 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** B1과 C1, C2가 대체한 `organize_attachments` 도구를 지운다.

**Architecture:** 도구 폴더 하나를 지우고 등록과 문서를 정리한다. 이 도구만 쓰던 `LinkExtractor`의 이미지 링크 함수가 다른 곳에서도 쓰이는지 확인하고, 쓰이면 남긴다.

**Tech Stack:** TypeScript

**Spec:** `docs/superpowers/specs/2026-11-20-vault-tidy-plugin-design.md` (7.2 E4)

## Global Constraints

`00-index.md`의 공통 제약을 따른다. 시작 조건은 I 통과다. I에서 B1 결과가 사용자 Vault 미리보기로 검토된 뒤에 지운다.

## Review Focus

- `DocumentIndex.imageLinks`를 다른 기능(`vault` 도구의 read 등)이 쓰는 경우: 지우지 않는다. Task 1에서 확인한다.

---

### Task 1: 도구 제거

**Files:**
- Delete: `src/tools/organize_attachments/`
- Modify: `src/tools/index.ts`(기존 `tools` 객체의 한 항목), `src/server.ts`(안내문의 한 줄), `docs/tool-reference.md`, `docs/tools-usage-guide.md`, README의 "제공 기능"

- [ ] **Step 1:** `grep -rn "organize_attachments\|OrganizeAttachmentsTool\|genreateOrganizationTasks" src tests docs README.md`의 사용처를 지운다. `docs/superpowers/`는 그대로 둔다.
- [ ] **Step 2:** `grep -rn "extractImageLinks\|imageLinks" src`로 남은 사용처를 확인하고, 남아 있으면 그대로 둔다.
- [ ] **Step 3: 확인** — `npm run build && npm test -- --run` → 둘 다 성공
- [ ] **Step 4: Commit** — `refactor: tidy_plan으로 대체된 organize_attachments 제거`
