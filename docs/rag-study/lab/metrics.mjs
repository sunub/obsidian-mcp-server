// 검색 평가 지표와 짝지은 부트스트랩 신뢰구간.

/** 정답 문서 중 상위 k개 안에 들어온 비율 */
export function recallAtK(ranked, relevant, k) {
	if (relevant.size === 0) return 0;
	return (
		ranked.slice(0, k).filter((id) => relevant.has(id)).length / relevant.size
	);
}

/** 1위가 정답이면 1 */
export function hitAt1(ranked, relevant) {
	return relevant.has(ranked[0]) ? 1 : 0;
}

/** 첫 정답 순위의 역수. k위 안에 없으면 0 */
export function reciprocalRank(ranked, relevant, k = 10) {
	const i = ranked.slice(0, k).findIndex((id) => relevant.has(id));
	return i === -1 ? 0 : 1 / (i + 1);
}

/**
 * nDCG@k. grades: 문서 → 관련도 등급(0,1,2…). 이진이면 정답 1.
 * DCG = Σ (2^rel - 1) / log2(i + 1), i는 1부터
 */
export function ndcgAtK(ranked, grades, k = 10) {
	const dcg = (rels) =>
		rels
			.slice(0, k)
			.reduce((s, r, i) => s + (2 ** r - 1) / Math.log2(i + 2), 0);
	const actual = dcg(ranked.map((id) => grades.get(id) ?? 0));
	const ideal = dcg([...grades.values()].sort((a, b) => b - a));
	return ideal === 0 ? 0 : actual / ideal;
}

export const mean = (xs) =>
	xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/** 시드가 있는 난수 (재현 가능) */
export function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * 짝지은 부트스트랩: 같은 질의에서 B - A 차이를 질의 단위로 복원추출해 평균의 분포를 만든다.
 * 95% 구간이 0을 포함하지 않으면 "차이가 있다"고 말할 근거가 된다.
 * @param {number[]} a 구성 A의 질의별 점수
 * @param {number[]} b 구성 B의 질의별 점수 (같은 순서)
 */
export function pairedBootstrap(a, b, { iters = 10000, seed = 42 } = {}) {
	if (a.length !== b.length) throw new Error("a와 b의 질의 수가 다르다");
	const diffs = a.map((x, i) => b[i] - x);
	const rand = mulberry32(seed);
	const n = diffs.length;
	const means = new Float64Array(iters);
	for (let it = 0; it < iters; it++) {
		let s = 0;
		for (let j = 0; j < n; j++) s += diffs[Math.floor(rand() * n)];
		means[it] = s / n;
	}
	means.sort();
	return {
		meanDiff: mean(diffs),
		lo: means[Math.floor(iters * 0.025)],
		hi: means[Math.floor(iters * 0.975)],
	};
}
