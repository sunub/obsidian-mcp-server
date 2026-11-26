// 청킹: 고정 크기, 재귀 분할(LangChain RecursiveCharacterTextSplitter와 같은 알고리즘), 제목 기준.
// length 함수로 길이를 잰다. 실습은 글자 수, 이 프로젝트는 임베딩 모델 토크나이저 토큰 수(256/32).

const charLen = (s) => s.length;

/** 고정 크기: 경계를 보지 않고 size마다 자른다. 다음 청크는 overlap만큼 앞에서 시작 */
export function fixedChunks(text, { size = 200, overlap = 20 } = {}) {
	const out = [];
	const step = Math.max(1, size - overlap);
	for (let start = 0; start < text.length; start += step) {
		out.push({
			text: text.slice(start, start + size),
			start,
			end: Math.min(text.length, start + size),
		});
		if (start + size >= text.length) break;
	}
	return out;
}

/**
 * 작은 조각들을 size 이하로 이어 붙인다. 청크를 내보낸 뒤에는 남은 길이가 overlap 이하가 될 때까지
 * 앞 조각을 버린다. 그때 남은 조각이 다음 청크의 앞부분, 즉 겹침이 된다.
 * (LangChain은 구분자를 다음 조각 앞에 붙여 두므로 이어 붙일 때 구분자를 따로 넣지 않는다)
 */
function mergeSplits(splits, size, overlap, length) {
	const docs = [];
	const cur = [];
	let total = 0;
	const flush = () => {
		const doc = cur.join("").trim();
		if (doc) docs.push(doc);
	};
	for (const d of splits) {
		const len = length(d);
		if (total + len > size && cur.length) {
			flush();
			while (total > overlap || (total + len > size && total > 0)) {
				total -= length(cur[0]);
				cur.shift();
			}
		}
		cur.push(d);
		total += len;
	}
	flush();
	return docs;
}

/** 구분자로 자르되 구분자는 뒤 조각의 앞에 남긴다 ("a\n\nb" → ["a", "\n\nb"]) */
function splitKeep(text, sep) {
	if (sep === "") return text.split("");
	const esc = sep.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&");
	return text.split(new RegExp(`(?=${esc})`)).filter((s) => s !== "");
}

function splitRecursive(text, separators, size, overlap, length) {
	// 텍스트에 들어 있는 첫 구분자를 고른다. ""는 글자 단위
	let sep = separators[separators.length - 1];
	let rest = null;
	for (let i = 0; i < separators.length; i++) {
		const s = separators[i];
		if (s === "") {
			sep = s;
			break;
		}
		if (text.includes(s)) {
			sep = s;
			rest = separators.slice(i + 1);
			break;
		}
	}
	const out = [];
	let good = [];
	for (const s of splitKeep(text, sep)) {
		if (length(s) < size) {
			good.push(s);
			continue;
		}
		if (good.length) out.push(...mergeSplits(good, size, overlap, length));
		good = [];
		// 이 조각 하나가 size 이상이면 더 작은 구분자로 내려간다
		if (rest) out.push(...splitRecursive(s, rest, size, overlap, length));
		else out.push(s);
	}
	if (good.length) out.push(...mergeSplits(good, size, overlap, length));
	return out;
}

/** 청크 문자열에 원문 위치를 붙인다 (겹침 표시용) */
function locate(text, chunks) {
	let from = 0;
	return chunks.map((c) => {
		let start = text.indexOf(c, from);
		if (start === -1) start = text.indexOf(c);
		from = start + 1;
		return { text: c, start, end: start + c.length };
	});
}

/** 재귀 분할: 문단 → 줄 → 공백 → 글자 순으로 시도 */
export function recursiveChunks(
	text,
	{
		size = 200,
		overlap = 20,
		separators = ["\n\n", "\n", " ", ""],
		length = charLen,
	} = {},
) {
	return locate(text, splitRecursive(text, separators, size, overlap, length));
}

/** 마크다운 H1~H3 위치 */
export function extractHeadings(text) {
	return [...text.matchAll(/^(#{1,3})\s+(.+)$/gm)].map((m) => ({
		heading: m[2].trim(),
		depth: m[1].length,
		pos: m.index ?? 0,
	}));
}

/** 제목 기준: 섹션마다 나누고, 긴 섹션만 재귀 분할한다 */
export function headingChunks(text, opts = {}) {
	const hs = extractHeadings(text);
	const cuts = [0, ...hs.map((h) => h.pos).filter((p) => p > 0), text.length];
	const out = [];
	for (let i = 0; i < cuts.length - 1; i++) {
		const section = text.slice(cuts[i], cuts[i + 1]);
		if (!section.trim()) continue;
		for (const c of recursiveChunks(section, opts)) {
			out.push({
				text: c.text,
				start: cuts[i] + c.start,
				end: cuts[i] + c.end,
			});
		}
	}
	return out;
}

/**
 * 이 프로젝트의 청크 문맥(chunkDocument.ts): 속한 섹션 제목 + 문서 개요(H1/H2 앞 3개).
 * 임베딩 입력은 context + "\n" + 본문이 된다.
 */
export function chunkContext(text, chunk) {
	const hs = extractHeadings(text);
	let section = null;
	for (const h of hs) if (h.pos <= chunk.start) section = h.heading;
	const outline = hs
		.filter((h) => h.depth <= 2)
		.slice(0, 4)
		.map((h) => h.heading.slice(0, 25));
	return [
		section ? `Section: ${section.slice(0, 30)}` : "",
		outline.length > 1 ? `Outline: ${outline.slice(0, 3).join(" > ")}` : "",
	]
		.filter(Boolean)
		.join("\n");
}
