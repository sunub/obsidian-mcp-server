// 역색인 + BM25, 그리고 비교용으로 이 프로젝트의 "IDF 가중 불리언 매칭".
import {
	queryTokenVariants,
	splitQuery,
	tokenizeDocument,
} from "./tokenize.mjs";

/**
 * 역색인을 만든다. BM25에는 단어 횟수(tf)와 문서 길이가 필요하다.
 * (이 프로젝트 Indexer는 Set<filePath>만 저장해서 tf와 길이가 없다)
 * @param {{id: string, text: string}[]} docs
 */
export function buildIndex(docs) {
	/** @type {Map<string, Map<string, number>>} 단어 → (문서 → 횟수) */
	const postings = new Map();
	const docLen = new Map();
	let totalLen = 0;
	for (const d of docs) {
		const toks = tokenizeDocument(d.text);
		docLen.set(d.id, toks.length);
		totalLen += toks.length;
		for (const t of toks) {
			let p = postings.get(t);
			if (!p) {
				p = new Map();
				postings.set(t, p);
			}
			p.set(d.id, (p.get(d.id) ?? 0) + 1);
		}
	}
	const N = docs.length;
	return { postings, docLen, N, avgdl: N ? totalLen / N : 0 };
}

/** Lucene BM25Similarity의 IDF. 항상 양수다 */
export function idfLucene(N, n) {
	return Math.log(1 + (N - n + 0.5) / (n + 0.5));
}

/** 한 단어가 한 문서에 주는 BM25 점수와 계산 과정 */
export function bm25Term(tf, dl, avgdl, idf, k1, b) {
	const norm = 1 - b + b * (avgdl ? dl / avgdl : 0);
	const tfPart = tf === 0 ? 0 : (tf * (k1 + 1)) / (tf + k1 * norm);
	return { norm, tfPart, score: idf * tfPart };
}

/**
 * BM25 검색. 질의는 본문과 같은 규칙으로 토큰화한다(같은 analyzer 원칙).
 * @returns {{id: string, score: number, terms: object[]}[]} 점수 내림차순
 */
export function bm25Search(index, query, { k1 = 1.2, b = 0.75 } = {}) {
	const qTerms = [...new Set(tokenizeDocument(query))];
	const scores = new Map();
	for (const term of qTerms) {
		const p = index.postings.get(term);
		if (!p) continue;
		const idf = idfLucene(index.N, p.size);
		for (const [id, tf] of p) {
			const dl = index.docLen.get(id);
			const r = bm25Term(tf, dl, index.avgdl, idf, k1, b);
			const cur = scores.get(id) ?? { id, score: 0, terms: [] };
			cur.score += r.score;
			cur.terms.push({
				term,
				tf,
				dl,
				avgdl: index.avgdl,
				n: p.size,
				N: index.N,
				idf,
				...r,
			});
			scores.set(id, cur);
		}
	}
	return [...scores.values()].sort((a, b) => b.score - a.score);
}

/** 이 프로젝트 Indexer.search의 최소 일치 조건 */
export function minShouldMatch(n) {
	if (n <= 2) return 1;
	if (n <= 4) return 2;
	return Math.floor(n * 0.5);
}

/**
 * 이 프로젝트 방식: 단어가 "있으면" ln(N/df)+1을 더한다. tf·길이는 보지 않는다.
 * = k1 = 0인 BM25와 같은 구조 (IDF 공식만 다름)
 */
export function projectSearch(index, query) {
	const tokens = splitQuery(query);
	const has = (t) => index.postings.get(t);
	const scores = new Map();
	for (const token of tokens) {
		const v = queryTokenVariants(token);
		const sets = [];
		for (const c of new Set([v.exact, v.trimmed]))
			if (c && has(c)) sets.push(new Set(has(c).keys()));
		if (v.parts.length) {
			const ps = v.parts.map((p) => has(p));
			if (ps.every(Boolean)) {
				const [first, ...rest] = ps;
				const both = new Set(
					[...first.keys()].filter((id) => rest.every((r) => r.has(id))),
				);
				if (both.size) sets.push(both);
			}
		}
		const best = new Map();
		for (const s of sets) {
			const idf = Math.log(index.N / s.size) + 1;
			for (const id of s) best.set(id, Math.max(best.get(id) ?? 0, idf));
		}
		for (const [id, idf] of best) {
			const cur = scores.get(id) ?? { id, score: 0, matched: 0, terms: [] };
			cur.score += idf;
			cur.matched += 1;
			cur.terms.push({ term: token, idf });
			scores.set(id, cur);
		}
	}
	const need = minShouldMatch(tokens.length);
	return [...scores.values()]
		.filter((s) => s.matched >= need)
		.sort((a, b) => b.score - a.score);
}
