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

export function hitAtK(
	ranked: string[],
	relevant: string[],
	k: number,
): number {
	const rel = new Set(relevant);
	return ranked.slice(0, k).some((d) => rel.has(d)) ? 1 : 0;
}

export function reciprocalRankAtK(
	ranked: string[],
	relevant: string[],
	k: number,
): number {
	const rel = new Set(relevant);
	const index = ranked.slice(0, k).findIndex((d) => rel.has(d));
	return index === -1 ? 0 : 1 / (index + 1);
}

export function ndcgAtK(
	ranked: string[],
	grades: Record<string, number>,
	k: number,
): number {
	const idealGrades = Object.values(grades)
		.filter((g) => g > 0)
		.sort((a, b) => b - a)
		.slice(0, k);
	if (idealGrades.length === 0) return 0;

	const gain = (grade: number) => (grade > 0 ? 2 ** grade - 1 : 0);
	const idcg = idealGrades.reduce(
		(sum, g, i) => sum + gain(g) / Math.log2(i + 2),
		0,
	);
	if (idcg === 0) return 0;

	const dcg = ranked
		.slice(0, k)
		.reduce(
			(sum, doc, i) => sum + gain(grades[doc] ?? 0) / Math.log2(i + 2),
			0,
		);
	return dcg / idcg;
}

export function bpref(
	ranked: string[],
	grades: Record<string, number>,
	minRelevantGrade = 2,
): number {
	const relevant = new Set<string>();
	const nonRelevant = new Set<string>();

	for (const [doc, grade] of Object.entries(grades)) {
		if (grade >= minRelevantGrade) {
			relevant.add(doc);
		} else {
			nonRelevant.add(doc);
		}
	}

	if (relevant.size === 0) return 0;
	if (nonRelevant.size === 0) {
		let found = 0;
		for (const doc of ranked) {
			if (relevant.has(doc)) found++;
		}
		return found / relevant.size;
	}

	const denom = Math.min(relevant.size, nonRelevant.size);
	let nonRelAbove = 0;
	let sum = 0;
	const seenRelevant = new Set<string>();

	for (const doc of ranked) {
		if (relevant.has(doc) && !seenRelevant.has(doc)) {
			seenRelevant.add(doc);
			const penalized = Math.min(nonRelAbove, denom);
			sum += 1 - penalized / denom;
		} else if (nonRelevant.has(doc)) {
			nonRelAbove++;
		}
	}

	return sum / relevant.size;
}

export function judgedAtK(
	ranked: string[],
	grades: Record<string, number>,
	k: number,
): number {
	const top = ranked.slice(0, k);
	if (top.length === 0) return 1;
	const judgedCount = top.filter((doc) => Object.hasOwn(grades, doc)).length;
	return judgedCount / top.length;
}

export function auroc(positives: number[], negatives: number[]): number {
	if (positives.length === 0 || negatives.length === 0) return Number.NaN;
	let wins = 0;
	for (const p of positives) {
		for (const n of negatives) {
			if (p > n) wins += 1;
			else if (p === n) wins += 0.5;
		}
	}
	return wins / (positives.length * negatives.length);
}

export function mean(values: number[]): number {
	if (values.length === 0) return Number.NaN;
	return values.reduce((a, b) => a + b, 0) / values.length;
}

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
