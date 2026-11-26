// 결합: Reciprocal Rank Fusion과, 비교용 min-max 점수 합산.

/**
 * RRF(d) = Σ_r w_r / (k + rank_r(d)). rank는 1부터.
 * @param {string[][]} lists 검색기별 순위 목록 (앞이 1위)
 * @param {number} k 기본 60 (Elasticsearch rank_constant 기본값)
 * @param {number[]} [weights] 검색기별 가중치. 없으면 모두 1
 */
export function rrf(lists, k = 60, weights) {
	const acc = new Map();
	lists.forEach((list, li) => {
		const w = weights?.[li] ?? 1;
		list.forEach((id, i) => {
			const rank = i + 1;
			const value = w / (k + rank);
			const cur = acc.get(id) ?? { id, score: 0, parts: [] };
			cur.score += value;
			cur.parts.push({ list: li, rank, value });
			acc.set(id, cur);
		});
	});
	return [...acc.values()].sort((a, b) => b.score - a.score);
}

/**
 * 점수를 검색기별로 min-max 정규화한 뒤 가중합한다. RRF와 비교하기 위한 것.
 * @param {{id: string, score: number}[][]} scoredLists
 */
export function minMaxFuse(scoredLists, weights) {
	const acc = new Map();
	scoredLists.forEach((list, li) => {
		const w = weights?.[li] ?? 1;
		const xs = list.map((x) => x.score);
		const lo = Math.min(...xs);
		const hi = Math.max(...xs);
		for (const { id, score } of list) {
			const norm = hi === lo ? 1 : (score - lo) / (hi - lo);
			acc.set(id, (acc.get(id) ?? 0) + w * norm);
		}
	});
	return [...acc.entries()]
		.map(([id, score]) => ({ id, score }))
		.sort((a, b) => b.score - a.score);
}
