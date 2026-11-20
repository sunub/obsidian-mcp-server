import { describe, expect, test } from "vitest";
import { topFolderOf } from "../../src/shared/vault-ops/boundary.js";
import { createLinkGraph } from "../../src/shared/vault-ops/graph.js";
import {
	makeOpId,
	newPlanId,
	newRunId,
	pathKey,
} from "../../src/shared/vault-ops/ids.js";
import { link } from "../helpers/vaultOps.js";

describe("vault-ops 기본 함수", () => {
	test("makeOpId는 종류와 키를 콜론으로 잇는다", () => {
		expect(makeOpId("move", "a/b.png")).toBe("move:a/b.png");
	});

	test("newPlanId는 연속 호출해도 겹치지 않는다", () => {
		const ids = new Set(Array.from({ length: 1000 }, () => newPlanId()));
		expect(ids.size).toBe(1000);
	});

	test("newRunId는 날짜-시각-난수 형식이다", () => {
		expect(newRunId()).toMatch(/^\d{8}-\d{6}-[0-9a-z]{6}$/);
	});

	test("pathKey는 NFC 소문자로 정규화한다", () => {
		expect(pathKey("자기소개서.md".normalize("NFD"))).toBe("자기소개서.md");
		expect(pathKey("A/B.MD")).toBe("a/b.md");
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
});
