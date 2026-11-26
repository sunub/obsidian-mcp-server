// ANN의 IVF(inverted file) 부분: k-means로 파티션을 나누고 가까운 파티션 nprobes개만 본다.
// (PQ 압축은 생략. 실습은 2차원, 이 프로젝트는 384차원 cosine + PQ)
import { mulberry32 } from "./metrics.mjs";

const dist2 = (a, b) => {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
	return s;
};

/**
 * k-means. 시드가 다르면 초기 중심이 달라져 파티션이 달라진다 → 재색인마다 결과가 흔들리는 이유.
 * @param {number[][]} points
 */
export function kmeans(points, k, { iters = 15, seed = 1 } = {}) {
	const rand = mulberry32(seed);
	const centroids = [];
	const used = new Set();
	while (centroids.length < Math.min(k, points.length)) {
		const i = Math.floor(rand() * points.length);
		if (!used.has(i)) {
			used.add(i);
			centroids.push([...points[i]]);
		}
	}
	let assign = new Array(points.length).fill(0);
	for (let it = 0; it < iters; it++) {
		assign = points.map((p) => nearest(centroids, p));
		const sums = centroids.map((c) => ({ v: c.map(() => 0), n: 0 }));
		points.forEach((p, i) => {
			const s = sums[assign[i]];
			s.n++;
			p.forEach((x, d) => {
				s.v[d] += x;
			});
		});
		sums.forEach((s, c) => {
			if (s.n) centroids[c] = s.v.map((x) => x / s.n);
		});
	}
	return { centroids, assign };
}

function nearest(centroids, p) {
	let best = 0;
	let bd = Infinity;
	centroids.forEach((c, i) => {
		const d = dist2(c, p);
		if (d < bd) {
			bd = d;
			best = i;
		}
	});
	return best;
}

/** 정확 검색: 모든 점과 거리를 잰다 */
export function exactTopK(points, q, k) {
	return points
		.map((p, i) => ({ i, d: dist2(p, q) }))
		.sort((a, b) => a.d - b.d)
		.slice(0, k)
		.map((x) => x.i);
}

/** IVF 색인을 만든다: 파티션 → 점 번호 목록 */
export function buildIvf(points, partitions, seed = 1) {
	const { centroids, assign } = kmeans(points, partitions, { seed });
	const lists = centroids.map(() => []);
	assign.forEach((c, i) => {
		lists[c].push(i);
	});
	return { points, centroids, lists, assign };
}

/** 질의와 가까운 파티션 nprobes개 안에서만 top-k를 찾는다 */
export function ivfSearch(ivf, q, k, nprobes) {
	const probes = ivf.centroids
		.map((c, i) => ({ i, d: dist2(c, q) }))
		.sort((a, b) => a.d - b.d)
		.slice(0, nprobes)
		.map((x) => x.i);
	const cand = probes.flatMap((p) => ivf.lists[p]);
	const top = cand
		.map((i) => ({ i, d: dist2(ivf.points[i], q) }))
		.sort((a, b) => a.d - b.d)
		.slice(0, k)
		.map((x) => x.i);
	return { top, probes, scanned: cand.length };
}
