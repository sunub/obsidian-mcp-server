/**
 * 검색 품질 지표와 지연 통계.
 * 문서 단위로 채점한다: ranked는 Vault 기준 상대 경로 목록(중복 없음, 순위순).
 */

export function recallAtK(
	ranked: string[],
	relevant: string[],
	k: number,
): number {
	if (relevant.length === 0) return 0;
	const top = new Set(ranked.slice(0, k));
	const hits = relevant.filter((r) => top.has(r)).length;
	return hits / relevant.length;
}

/** 상위 k개 안에 정답이 하나라도 있으면 1 */
export function hitAtK(
	ranked: string[],
	relevant: string[],
	k: number,
): number {
	const rel = new Set(relevant);
	return ranked.slice(0, k).some((d) => rel.has(d)) ? 1 : 0;
}

/** 첫 정답 순위의 역수. 상위 k개 안에 없으면 0 */
export function reciprocalRankAtK(
	ranked: string[],
	relevant: string[],
	k: number,
): number {
	const rel = new Set(relevant);
	const index = ranked.slice(0, k).findIndex((d) => rel.has(d));
	return index === -1 ? 0 : 1 / (index + 1);
}

export function mean(values: number[]): number {
	if (values.length === 0) return Number.NaN;
	return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 선형 보간 백분위수 (p: 0~100) */
export function percentile(values: number[], p: number): number {
	if (values.length === 0) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(rank);
	const hi = Math.ceil(rank);
	const loValue = sorted[lo] as number;
	const hiValue = sorted[hi] as number;
	return loValue + (hiValue - loValue) * (rank - lo);
}

/** 재현 가능한 난수 (mulberry32) */
export function seededRandom(seed: number): () => number {
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
 * 짝지은 부트스트랩: 같은 질의에서 두 구성의 점수 차이(b - a)의 평균과 95% 신뢰구간.
 * 질의 수가 적으므로 차이가 신뢰구간 안에서 0을 포함하면 "차이 없음"으로 읽는다.
 */
export function pairedBootstrap(
	a: number[],
	b: number[],
	iterations = 10000,
	seed = 42,
): { meanDiff: number; ciLow: number; ciHigh: number } {
	if (a.length !== b.length || a.length === 0) {
		throw new Error(
			"pairedBootstrap: 두 배열의 길이가 같고 비어 있지 않아야 합니다.",
		);
	}
	const diffs = a.map((value, i) => (b[i] as number) - value);
	const random = seededRandom(seed);
	const samples: number[] = [];
	for (let i = 0; i < iterations; i++) {
		let sum = 0;
		for (let j = 0; j < diffs.length; j++) {
			sum += diffs[Math.floor(random() * diffs.length)] as number;
		}
		samples.push(sum / diffs.length);
	}
	return {
		meanDiff: mean(diffs),
		ciLow: percentile(samples, 2.5),
		ciHigh: percentile(samples, 97.5),
	};
}
