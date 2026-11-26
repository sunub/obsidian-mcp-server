// 토큰화: 색인과 질의가 같은 규칙으로 잘려야 일치한다.
// 이 프로젝트 src/shared/indexing/Indexer.ts의 규칙을 그대로 옮겼다.

/** 본문 색인 토큰: 소문자 영숫자와 완성형 한글의 연속 */
export const INDEX_TOKEN = /[a-z0-9가-힣]+/g;
const EDGE_PUNCT = /^[^a-z0-9가-힣]+|[^a-z0-9가-힣]+$/g;

/** 본문을 색인 토큰 배열로 자른다 (중복 포함, 순서 유지) */
export function tokenizeDocument(text) {
	return text.toLowerCase().match(INDEX_TOKEN) ?? [];
}

/** 질의를 공백으로 자른다 (2026-11-10 이전과 이후 모두 이 단계는 같다) */
export function splitQuery(query) {
	return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/**
 * 질의 토큰 하나가 색인과 맞을 수 있는 형태들.
 * - exact:   입력 그대로 ("c++", "my-note"처럼 태그·파일명은 원형으로 색인된다)
 * - trimmed: 앞뒤 문장부호를 뗀 형태 ("lancedb," → "lancedb")
 * - parts:   중간 문장부호로 나뉜 조각 중 두 글자 이상 ("next.js" → ["next", "js"]).
 *            조각이 2개 이상일 때만 쓰고, 그 조각이 "모두" 있는 문서를 일치로 본다.
 */
export function queryTokenVariants(token) {
	const t = token.toLowerCase();
	const trimmed = t.replace(EDGE_PUNCT, "");
	const parts = (t.match(INDEX_TOKEN) ?? []).filter((p) => p.length > 1);
	return { exact: t, trimmed, parts: parts.length > 1 ? parts : [] };
}
