import { describe, expect, test } from "vitest";
import {
	hitAtK,
	pairedBootstrap,
	percentile,
	recallAtK,
	reciprocalRankAtK,
} from "../../scripts/eval/lib/metrics.js";

describe("검색 평가 지표", () => {
	const ranked = ["a.md", "b.md", "c.md", "d.md"];

	test("recallAtK는 상위 k개 안에 든 정답 비율을 계산한다", () => {
		expect(recallAtK(ranked, ["b.md", "z.md"], 2)).toBe(0.5);
		expect(recallAtK(ranked, ["c.md"], 2)).toBe(0);
		expect(recallAtK(ranked, ["c.md"], 3)).toBe(1);
	});

	test("hitAtK는 정답이 하나라도 있으면 1이다", () => {
		expect(hitAtK(ranked, ["d.md", "a.md"], 1)).toBe(1);
		expect(hitAtK(ranked, ["d.md"], 3)).toBe(0);
	});

	test("reciprocalRankAtK는 첫 정답 순위의 역수이고 k 밖이면 0이다", () => {
		expect(reciprocalRankAtK(ranked, ["c.md", "d.md"], 10)).toBeCloseTo(1 / 3);
		expect(reciprocalRankAtK(ranked, ["d.md"], 3)).toBe(0);
	});

	test("percentile은 선형 보간한다", () => {
		expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
		expect(percentile([10], 95)).toBe(10);
		expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
	});

	test("pairedBootstrap은 같은 입력에 같은 결과를 내고 차이의 부호를 보존한다", () => {
		const a = [0, 0, 0, 0, 1, 1];
		const b = [1, 1, 0, 1, 1, 1];
		const first = pairedBootstrap(a, b, 2000, 7);
		const second = pairedBootstrap(a, b, 2000, 7);
		expect(first).toEqual(second);
		expect(first.meanDiff).toBeCloseTo(0.5);
		expect(first.ciLow).toBeGreaterThanOrEqual(0);
		expect(first.ciHigh).toBeLessThanOrEqual(1);
	});
});
