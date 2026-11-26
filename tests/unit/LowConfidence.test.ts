import { afterEach, describe, expect, test, vi } from "vitest";
import { parseLowConfidenceDenseThreshold } from "../../src/config";
import { isLowConfidence } from "../../src/shared/search-backend/lowConfidence";
import { searchStatusSchema } from "../../src/shared/searchStatus";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("isLowConfidence", () => {
	test.each([
		["낮은 신뢰도", true, 0.879, 0, undefined, true],
		["경계값 허용", true, 0.88, 0, undefined, false],
		["높은 유사도 허용", true, 0.91, 0, undefined, false],
		["키워드 일치 보호", true, 0.7, 4.5, undefined, false],
		["키워드 폴백 보호", false, 0, 0, undefined, false],
		["판정 비활성화", true, 0.1, 0, 0, false],
	])("%s", (_name, hasSemanticSearch, topDenseSimilarity, topBm25Score, threshold, expected) => {
		expect(
			isLowConfidence({
				hasSemanticSearch,
				topDenseSimilarity,
				topBm25Score,
				threshold,
			}),
		).toBe(expected);
	});
});

describe("LOW_CONFIDENCE_DENSE_THRESHOLD", () => {
	test.each([
		[undefined, 0.88],
		["0", 0],
		["1", 1],
		["0.9", 0.9],
	])("%s는 %s로 읽는다", (raw, expected) => {
		const warn = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(parseLowConfidenceDenseThreshold(raw)).toBe(expected);
		expect(warn).not.toHaveBeenCalled();
	});

	test.each([
		"-0.1",
		"1.1",
		"abc",
		"",
		"  ",
	])("잘못된 값 '%s'는 경고를 남기고 0.88을 쓴다", (raw) => {
		const warn = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(parseLowConfidenceDenseThreshold(raw)).toBe(0.88);
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

test("search_status는 low_confidence 사유를 허용한다", () => {
	expect(
		searchStatusSchema.safeParse({
			mode: "hybrid",
			reason: "low_confidence",
		}).success,
	).toBe(true);
});
