import { describe, expect, test } from "vitest";
import { stripJosa } from "../../src/shared/indexing/keyword-search/josa";

describe("stripJosa 접미사 결정", () => {
	test.each([
		["집으로"],
		["책이라는"],
	])("가장 긴 접미사로 어간이 너무 짧아지면 더 짧은 접미사로 다시 자르지 않는다: %s", (token) => {
		expect(stripJosa(token)).toBe(token);
	});

	test.each([
		["서버에서는", "서버"],
		["임베딩으로", "임베딩"],
	])("가장 긴 접미사가 맞으면 그 접미사만 뗀다: %s", (token, stem) => {
		expect(stripJosa(token)).toBe(stem);
	});
});
