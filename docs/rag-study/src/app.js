// 학습 문서 UI. 실습 계산은 모두 LAB_* (lab/*.mjs를 그대로 넣은 것)로 한다.
const PRISTINE = `<!DOCTYPE html>\n${document.documentElement.outerHTML.replace(/ data-theme="[^"]*"/, "")}`;
const L = Object.assign(
	{},
	LAB_metrics,
	LAB_tokenize,
	LAB_bm25,
	LAB_rrf,
	LAB_chunker,
	LAB_ivf,
);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
	String(s).replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
	);
const fx = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "–");
const store = {
	get(k, d) {
		try {
			const v = localStorage.getItem(k);
			return v == null ? d : JSON.parse(v);
		} catch {
			return d;
		}
	},
	set(k, v) {
		try {
			localStorage.setItem(k, JSON.stringify(v));
		} catch {}
	},
};
const TERM_COLORS = [
	"var(--accent)",
	"var(--green)",
	"var(--purple)",
	"var(--amber)",
	"var(--cyan)",
	"var(--red)",
];
const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}, text) {
	const el = document.createElementNS(SVGNS, tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	if (text != null) el.textContent = text;
	return el;
}
function toast(msg) {
	const t = $("#toast");
	t.textContent = msg;
	t.classList.add("show");
	clearTimeout(toast.h);
	toast.h = setTimeout(() => t.classList.remove("show"), 1800);
}
function bindRange(id, fn, fmt = (v) => v) {
	const el = $(`#${id}`);
	const out = $(`#${id}-o`);
	const upd = () => {
		if (out) out.textContent = fmt(el.value);
		fn();
	};
	el.addEventListener("input", upd);
	if (out) out.textContent = fmt(el.value);
}

/* ------------------------------------------------------------ 테마 */
function setTheme(t) {
	document.documentElement.dataset.theme = t;
	$("#theme-btn").textContent = t === "dark" ? "☀️ 라이트" : "🌙 다크";
	store.set("rag-theme", t);
}
$("#theme-btn").addEventListener("click", () =>
	setTheme(
		document.documentElement.dataset.theme === "dark" ? "light" : "dark",
	),
);
setTheme(document.documentElement.dataset.theme || "dark");

/* ------------------------------------------------------------ 라우터와 진도 */
const modules = $$(".module");
const done = new Set(store.get("rag-done", []));
function buildNav() {
	const nav = $("#nav");
	nav.innerHTML = "";
	let group = null;
	let n = 0;
	for (const m of modules) {
		if (m.dataset.group !== group) {
			group = m.dataset.group;
			nav.append(
				Object.assign(document.createElement("div"), {
					className: "group",
					textContent: group,
				}),
			);
		}
		n++;
		const a = document.createElement("a");
		a.href = `#${m.id}`;
		a.dataset.id = m.id;
		a.innerHTML = `<span class="num"><b>${n}</b></span><span>${esc(m.dataset.nav)}</span>`;
		nav.append(a);
	}
	const rm = $("#roadmap");
	rm.innerHTML = modules
		.filter((m) => m.id !== "m-home")
		.map(
			(m, i) =>
				`<a href="#${m.id}" data-id="${m.id}"><span class="k">${String(i + 1).padStart(2, "0")} · ${esc(m.dataset.group)}</span><br>${esc(m.dataset.nav)}${m.dataset.sub ? `<small>${esc(m.dataset.sub)}</small>` : ""}</a>`,
		)
		.join("");
}
function addFooters() {
	modules.forEach((m, i) => {
		const prev = modules[i - 1];
		const next = modules[i + 1];
		const f = document.createElement("div");
		f.className = "mod-foot";
		f.innerHTML = `${prev ? `<a class="btn" href="#${prev.id}">← ${esc(prev.dataset.nav)}</a>` : "<span></span>"}
			<button class="btn done-btn" data-id="${m.id}"></button>
			${next ? `<a class="btn primary" href="#${next.id}">${esc(next.dataset.nav)} →</a>` : "<span></span>"}`;
		m.append(f);
	});
	$$(".done-btn").forEach((b) =>
		b.addEventListener("click", () => {
			const id = b.dataset.id;
			if (done.has(id)) done.delete(id);
			else done.add(id);
			store.set("rag-done", [...done]);
			refreshProgress();
		}),
	);
}
function refreshProgress() {
	const total = modules.length;
	$$("[data-id]").forEach((el) =>
		el.classList.toggle(
			"done",
			done.has(el.dataset.id) && !el.classList.contains("done-btn"),
		),
	);
	$$(".done-btn").forEach((b) => {
		const d = done.has(b.dataset.id);
		b.classList.toggle("is-done", d);
		b.textContent = d ? "✓ 공부 완료" : "이 모듈 완료로 표시";
	});
	const pct = Math.round((done.size / total) * 100);
	$("#progress-bar").style.width = `${pct}%`;
	$("#progress-label").textContent = `${done.size}/${total} 완료`;
}
function show(id) {
	let found = false;
	for (const m of modules) {
		const on = m.id === id;
		m.classList.toggle("show", on);
		found ||= on;
	}
	if (!found) return show("m-home");
	$$("#nav a").forEach((a) =>
		a.classList.toggle("active", a.dataset.id === id),
	);
	document.body.classList.remove("nav-open");
	const m = document.getElementById(id);
	document.title = `${m.dataset.nav} · RAG 학습 코스`;
	window.dispatchEvent(new CustomEvent("module-shown", { detail: id }));
}
function route(hash = location.hash) {
	const h = decodeURIComponent(hash.slice(1));
	if (!h)
		return show("m-home"), window.scrollTo({ top: 0, behavior: "instant" });
	if (h.startsWith("m-"))
		return show(h), window.scrollTo({ top: 0, behavior: "instant" });
	const el = document.getElementById(h);
	if (!el) return show("m-home");
	show(el.closest(".module").id);
	requestAnimationFrame(() => {
		el.scrollIntoView({ block: "center" });
		el.classList.add("flash");
		setTimeout(() => el.classList.remove("flash"), 1700);
	});
}
window.addEventListener("hashchange", () => route());
window.addEventListener("popstate", () => route());
// 해시를 바꿀 수 없는 환경(미리보기의 data: URL 등)에서도 이동되도록 링크를 직접 처리한다
document.addEventListener("click", (e) => {
	const a = e.target.closest('a[href^="#"]');
	if (!a || e.metaKey || e.ctrlKey) return;
	e.preventDefault();
	const href = a.getAttribute("href");
	try {
		history.pushState(null, "", href);
	} catch {}
	route(href);
});
$("#menu-btn").addEventListener("click", () =>
	document.body.classList.toggle("nav-open"),
);

/* ------------------------------------------------------------ 내려받기와 코드 보기 */
const LAB_FILES = $$("script[data-file]").map((s) => ({
	name: s.dataset.file,
	text: s.textContent.replace(/<\\\/script/g, "</script"),
}));
const FILE_DESC = {
	"tokenize.mjs": ["토큰화 규칙과 질의 토큰의 세 가지 형태", "m-index"],
	"bm25.mjs": ["역색인, BM25, 이 프로젝트 방식(IDF 가중 불리언)", "m-bm25"],
	"rrf.mjs": ["RRF와 min-max 결합", "m-hybrid"],
	"chunker.mjs": [
		"고정 / 재귀(LangChain과 동일) / 제목 기준 청킹, 섹션 문맥",
		"m-chunk",
	],
	"metrics.mjs": ["Recall@k, Hit@1, MRR, nDCG, 짝지은 부트스트랩", "m-eval"],
	"ivf.mjs": ["k-means, 정확 검색, IVF 검색", "m-ann"],
	"lab.test.mjs": ["개념마다 하나씩, 15개 테스트", ""],
	"README.md": ["실행 방법과 과제", ""],
};
function download(name, data, type) {
	const blob = data instanceof Blob ? data : new Blob([data], { type });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = name;
	document.body.append(a);
	a.click();
	setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
	toast(`${name} 내려받기`);
}
const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
/** 압축하지 않는(store) ZIP. 파일 이름은 UTF-8 */
function makeZip(files) {
	const enc = new TextEncoder();
	const parts = [];
	const central = [];
	let offset = 0;
	for (const f of files) {
		const name = enc.encode(f.name);
		const data = enc.encode(f.text);
		const crc = crc32(data);
		const lh = new DataView(new ArrayBuffer(30));
		lh.setUint32(0, 0x04034b50, true);
		lh.setUint16(4, 20, true);
		lh.setUint16(6, 0x0800, true);
		lh.setUint16(12, 0x5b70, true);
		lh.setUint32(14, crc, true);
		lh.setUint32(18, data.length, true);
		lh.setUint32(22, data.length, true);
		lh.setUint16(26, name.length, true);
		parts.push(new Uint8Array(lh.buffer), name, data);
		const ch = new DataView(new ArrayBuffer(46));
		ch.setUint32(0, 0x02014b50, true);
		ch.setUint16(4, 20, true);
		ch.setUint16(6, 20, true);
		ch.setUint16(8, 0x0800, true);
		ch.setUint16(14, 0x5b70, true);
		ch.setUint32(16, crc, true);
		ch.setUint32(20, data.length, true);
		ch.setUint32(24, data.length, true);
		ch.setUint16(28, name.length, true);
		ch.setUint32(42, offset, true);
		central.push(new Uint8Array(ch.buffer), name);
		offset += 30 + name.length + data.length;
	}
	const cdSize = central.reduce((s, p) => s + p.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, files.length, true);
	end.setUint16(10, files.length, true);
	end.setUint32(12, cdSize, true);
	end.setUint32(16, offset, true);
	return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
		type: "application/zip",
	});
}
document.addEventListener("click", (e) => {
	const dl = e.target.closest("[data-dl]");
	if (dl) {
		const k = dl.dataset.dl;
		if (k === "page") download("rag-study-guide.html", PRISTINE, "text/html");
		else if (k === "zip")
			download(
				"rag-lab.zip",
				makeZip(
					LAB_FILES.map((f) => ({ name: `rag-lab/${f.name}`, text: f.text })),
				),
			);
		else {
			const f = LAB_FILES.find((x) => x.name === k);
			if (f) download(f.name, f.text, "text/plain");
		}
	}
	const src = e.target.closest("[data-src]");
	if (src) openSource(src.dataset.src);
});
function highlight(code) {
	const KW =
		/\b(export|import|from|function|const|let|return|for|of|if|else|new|while|throw|async|await|break|continue)\b/g;
	return code
		.split("\n")
		.map((line) => {
			let cut = -1;
			let q = null;
			for (let i = 0; i < line.length - 1; i++) {
				const c = line[i];
				if (q) {
					if (c === "\\") i++;
					else if (c === q) q = null;
				} else if (c === '"' || c === "'" || c === "`") q = c;
				else if (
					c === "/" &&
					line[i + 1] === "/" &&
					line[i - 1] !== "\\" &&
					line[i - 1] !== ":"
				) {
					cut = i;
					break;
				}
			}
			const body = cut === -1 ? line : line.slice(0, cut);
			const cm =
				cut === -1 ? "" : `<span class="cm">${esc(line.slice(cut))}</span>`;
			const h = esc(body)
				.replace(/(&quot;[^&]*?&quot;|`[^`]*`)/g, '<span class="st">$1</span>')
				.replace(KW, '<span class="kw">$1</span>');
			const trimmed = line.trimStart();
			if (trimmed.startsWith("*") || trimmed.startsWith("/**"))
				return `<span class="cm">${esc(line)}</span>`;
			return h + cm;
		})
		.join("\n");
}
function openSource(name) {
	const f = LAB_FILES.find((x) => x.name === name);
	if (!f) return;
	const d = $("#src-dialog");
	$("#src-name").textContent = name;
	$("#src-code").innerHTML = name.endsWith(".md")
		? esc(f.text)
		: highlight(f.text);
	$("#src-dl").dataset.dl = name;
	d.showModal();
}
$("#src-close").addEventListener("click", () => $("#src-dialog").close());
$("#src-copy").addEventListener("click", async () => {
	const f = LAB_FILES.find((x) => x.name === $("#src-name").textContent);
	try {
		await navigator.clipboard.writeText(f.text);
		toast("복사했습니다");
	} catch {
		toast("복사할 수 없는 환경입니다. 내려받기를 쓰세요");
	}
});
$("#src-dialog").addEventListener("click", (e) => {
	if (e.target.id === "src-dialog") e.target.close();
});
function renderCodeFiles() {
	$("#code-files").innerHTML =
		`<table><tr><th>파일</th><th>내용</th><th class="n">줄</th><th></th></tr>${LAB_FILES.map(
			(f) => {
				const [desc, mod] = FILE_DESC[f.name] ?? ["", ""];
				return `<tr><td><code>${esc(f.name)}</code></td><td>${esc(desc)}${mod ? ` · <a href="#${mod}">실습 보기</a>` : ""}</td><td class="n">${f.text.split("\n").length}</td><td style="white-space:nowrap"><button class="btn sm" data-src="${esc(f.name)}">보기</button> <button class="btn sm" data-dl="${esc(f.name)}">⬇</button></td></tr>`;
			},
		).join("")}</table>`;
}

/* ------------------------------------------------------------ 공통: 순위 목록 렌더링 */
function rankRows(items, { max, sub, terms, click, sel } = {}) {
	if (!items.length) return `<div class="empty">결과 없음</div>`;
	const top = max ?? Math.max(...items.map((x) => x.score), 1e-9);
	return items
		.map((it, i) => {
			const segs = terms
				? terms(it)
						.map(
							(t) =>
								`<i style="width:${(t.value / top) * 100}%;background:${t.color}"></i>`,
						)
						.join("")
				: `<i style="width:${(it.score / top) * 100}%;background:var(--accent)"></i>`;
			return `<div class="rank-row${click ? " click" : ""}${sel === it.id ? " sel" : ""}" data-id="${esc(it.id)}"><span class="r">${i + 1}</span><span class="name">${esc(it.id)}${sub ? `<small>${sub(it)}</small>` : ""}<div class="bar" style="margin-top:4px">${segs}</div></span><span class="s">${fx(it.score)}</span></div>`;
		})
		.join("");
}
function parseDocs(text) {
	return text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l, i) => {
			const m = l.match(/^([^:]+):\s*(.*)$/);
			return m
				? { id: m[1].trim(), text: m[2] }
				: { id: `doc${i + 1}`, text: l };
		});
}

/* ------------------------------------------------------------ 미니 RAG */
const NOTES = [
	[
		"lancedb-index.md",
		"LanceDB는 IVF-PQ 색인을 쓴다. 색인을 다시 만들면 k-means 파티션이 달라져 검색 결과가 조금씩 달라진다. 그래서 실험은 세 번 반복해 평균을 냈다.",
	],
	[
		"chunk-size.md",
		"청크 크기를 임베딩 모델 토큰 기준 256으로 줄였다. 벡터 검색 MRR이 0.325에서 0.456으로 올랐다.",
	],
	[
		"reranker.md",
		"bge-reranker-base 리랭커를 붙였더니 지연이 5초를 넘었고 MRR은 오르지 않았다. 그래서 리랭커를 뺐다.",
	],
	[
		"car-repair.md",
		"자동차 수리 기록. 엔진 오일을 교체하고 브레이크 패드를 갈았다.",
	],
	["pasta.md", "토마토 파스타 레시피. 마늘을 볶고 토마토 소스를 넣는다."],
	[
		"tokenizer-bug.md",
		"질의는 공백으로, 본문은 문장부호에서 잘라서 tailwind-merge 같은 질의가 맞지 않았다.",
	],
];
function initMiniRag() {
	const idx = L.buildIndex(NOTES.map(([id, text]) => ({ id, text })));
	const run = () => {
		const q = $("#mr-q").value;
		const k = +$("#mr-k").value;
		const hits = L.bm25Search(idx, q).slice(0, k);
		$("#mr-hits").innerHTML = rankRows(hits, {
			sub: (h) => `${esc(NOTES.find((n) => n[0] === h.id)[1].slice(0, 46))}…`,
		});
		const ctx = hits
			.map(
				(h, i) =>
					`[자료 ${i + 1}] ${h.id}\n${NOTES.find((n) => n[0] === h.id)[1]}`,
			)
			.join("\n\n");
		$("#mr-prompt").textContent =
			`다음 자료만 근거로 질문에 답하세요.\n자료에 없으면 "자료에 없습니다"라고 답하세요.\n\n${ctx || "(검색된 자료 없음 → 모델은 자기 기억만으로 답하게 된다)"}\n\n질문: ${q}`;
	};
	$("#mr-q").addEventListener("input", run);
	bindRange("mr-k", run);
	run();
}

/* ------------------------------------------------------------ 역색인과 토큰화 */
function initIndexLab() {
	$("#ix-docs").value = [
		"lancedb.md: LanceDB 인덱스를 다시 만든다. IVF-PQ 파라미터를 바꿨다.",
		"nextjs.md: Next.js 15에서 동적 라우트를 쓴다. tailwind-merge 패키지도 설치했다.",
		"plan.md: next step을 정한다. 검색을 개선하는 계획. 변수 i 와 o.",
	].join("\n");
	const run = () => {
		const docs = parseDocs($("#ix-docs").value);
		const idx = L.buildIndex(docs);
		const has = (t) => idx.postings.get(t);
		const docsOf = (t) => [...(has(t)?.keys() ?? [])];
		const matchedTokens = new Set();
		const rows = L.splitQuery($("#ix-q").value).map((tok) => {
			const v = L.queryTokenVariants(tok);
			const before = docsOf(v.exact);
			if (before.length) matchedTokens.add(v.exact);
			const after = new Set(before);
			const how = [];
			if (before.length)
				how.push(`원형 <span class="chip ok">${esc(v.exact)}</span>`);
			if (v.trimmed && v.trimmed !== v.exact && has(v.trimmed)) {
				matchedTokens.add(v.trimmed);
				docsOf(v.trimmed).forEach((d) => after.add(d));
				how.push(`앞뒤 제거 <span class="chip ok">${esc(v.trimmed)}</span>`);
			}
			if (v.parts.length) {
				const sets = v.parts.map((p) => has(p));
				if (sets.every(Boolean)) {
					const both = docsOf(v.parts[0]).filter((d) =>
						sets.every((s) => s.has(d)),
					);
					if (both.length) {
						v.parts.forEach((p) => matchedTokens.add(p));
						both.forEach((d) => after.add(d));
						how.push(
							`조각 모두 ${v.parts.map((p) => `<span class="chip ok">${esc(p)}</span>`).join("+")}`,
						);
					}
				}
			}
			const raw = (tok.match(L.INDEX_TOKEN) ?? []).filter(
				(p) => p.length === 1,
			);
			const note =
				raw.length &&
				!v.parts.length &&
				(tok.match(L.INDEX_TOKEN) ?? []).length > 1
					? `<br><small style="color:var(--faint)">한 글자 조각 ${raw.map(esc).join(", ")}은 버림</small>`
					: "";
			const chips = (arr) =>
				arr.length
					? arr.map((d) => `<span class="chip">${esc(d)}</span>`).join("")
					: `<span class="chip no">없음</span>`;
			return `<tr><td><code>${esc(tok)}</code></td><td>${chips(before)}</td><td>${chips([...after])}<br><small style="color:var(--muted)">${how.join(" · ") || "맞는 형태 없음"}</small>${note}</td></tr>`;
		});
		$("#ix-match").innerHTML = rows.length
			? `<div class="table-wrap" style="margin:0"><table><tr><th>질의 토큰</th><th>수정 전</th><th>수정 후</th></tr>${rows.join("")}</table></div>`
			: `<div class="empty">질의를 입력하세요</div>`;
		$("#ix-toks").innerHTML = docs
			.map(
				(d) =>
					`<div style="margin-bottom:6px"><b style="font-size:13px">${esc(d.id)}</b><br>${L.tokenizeDocument(
						d.text,
					)
						.map(
							(t) =>
								`<span class="chip${matchedTokens.has(t) ? " on" : ""}">${esc(t)}</span>`,
						)
						.join("")}</div>`,
			)
			.join("");
		const keys = [...idx.postings.keys()].sort(
			(a, b) =>
				matchedTokens.has(b) - matchedTokens.has(a) || a.localeCompare(b),
		);
		$("#ix-inv").innerHTML =
			`<table><tr><th>토큰</th><th>문서 (tf)</th></tr>${keys
				.map(
					(t) =>
						`<tr${matchedTokens.has(t) ? ' class="hl"' : ""}><td><code>${esc(t)}</code></td><td>${[...idx.postings.get(t)].map(([d, n]) => `${esc(d)} (${n})`).join(", ")}</td></tr>`,
				)
				.join("")}</table>`;
	};
	$("#ix-docs").addEventListener("input", run);
	$("#ix-q").addEventListener("input", run);
	run();
}

/* ------------------------------------------------------------ BM25 그림 */
function drawBm25Chart() {
	const svg = $("#bm25-chart");
	const k1 = +$("#bc-k1").value;
	const b = +$("#bc-b").value;
	svg.innerHTML = "";
	const W = 640;
	const H = 300;
	const pad = { l: 50, r: 20, t: 20, b: 40 };
	const xMax = 10;
	const yMax = 4.2;
	const X = (v) => pad.l + (v / xMax) * (W - pad.l - pad.r);
	const Y = (v) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
	for (let y = 0; y <= 4; y++) {
		svg.append(
			svgEl("line", {
				x1: X(0),
				x2: X(xMax),
				y1: Y(y),
				y2: Y(y),
				class: "grid",
			}),
		);
		svg.append(
			svgEl(
				"text",
				{
					x: X(0) - 10,
					y: Y(y) + 4,
					"text-anchor": "end",
					"font-size": 12,
					class: "muted",
				},
				y,
			),
		);
	}
	for (let x = 0; x <= xMax; x += 2)
		svg.append(
			svgEl(
				"text",
				{
					x: X(x),
					y: H - pad.b + 18,
					"text-anchor": "middle",
					"font-size": 12,
					class: "muted",
				},
				x,
			),
		);
	svg.append(
		svgEl(
			"text",
			{
				x: X(xMax / 2),
				y: H - 6,
				"text-anchor": "middle",
				"font-size": 12,
				class: "muted",
			},
			"단어 횟수 tf",
		),
	);
	svg.append(
		svgEl("line", {
			x1: X(0),
			x2: X(xMax),
			y1: Y(k1 + 1),
			y2: Y(k1 + 1),
			stroke: "var(--red)",
			"stroke-dasharray": "5 4",
		}),
	);
	svg.append(
		svgEl(
			"text",
			{
				x: X(xMax) - 4,
				y: Y(k1 + 1) - 7,
				"font-size": 12,
				fill: "var(--red)",
				"text-anchor": "end",
			},
			`상한 k1+1 = ${fx(k1 + 1, 1)}`,
		),
	);
	const lines = [
		[0.5, "var(--green)", "짧은 문서 (0.5×평균)"],
		[1, "var(--accent)", "평균 길이"],
		[2, "var(--amber)", "긴 문서 (2×평균)"],
	];
	lines.forEach(([ratio, color, label], i) => {
		let d = "";
		for (let tf = 0; tf <= xMax; tf += 0.1) {
			const y = L.bm25Term(tf, ratio * 10, 10, 1, k1, b).tfPart;
			d += `${d ? "L" : "M"}${X(tf).toFixed(1)},${Y(y).toFixed(1)}`;
		}
		svg.append(
			svgEl("path", { d, fill: "none", stroke: color, "stroke-width": 2.4 }),
		);
		svg.append(
			svgEl("rect", {
				x: X(0.4),
				y: pad.t + 2 + i * 18,
				width: 14,
				height: 4,
				rx: 2,
				style: `fill:${color}`,
			}),
		);
		svg.append(
			svgEl(
				"text",
				{ x: X(0.4) + 20, y: pad.t + 8 + i * 18, "font-size": 12, fill: color },
				label,
			),
		);
	});
}
function initBm25Chart() {
	bindRange("bc-k1", drawBm25Chart);
	bindRange("bc-b", drawBm25Chart);
	drawBm25Chart();
}

/* ------------------------------------------------------------ BM25 실습 */
function initBm25Lab() {
	$("#bm-docs").value = [
		"lancedb-short: LanceDB 색인 메모. LanceDB 색인을 다시 만든다.",
		"lancedb-mention: 검색 개선 계획. 벡터 저장소로 LanceDB를 쓴다.",
		"long-log: 작업 일지. 오늘은 회의를 했다. 점심을 먹었다. 오후에 LanceDB 색인 문서를 읽었다. 저녁에는 운동을 했다. 회의록을 정리했다. 내일 할 일을 적었다. 메일을 확인했다. 리뷰를 했다. 색인 관련 질문에 답했다.",
		"chunk: 청킹 크기 실험. 256 토큰으로 줄였다.",
		"rrf: RRF로 키워드와 벡터 결과를 합친다.",
	].join("\n");
	let sel = "lancedb-short";
	const run = () => {
		const docs = parseDocs($("#bm-docs").value);
		const idx = L.buildIndex(docs);
		const k1 = +$("#bm-k1").value;
		const b = +$("#bm-b").value;
		const q = $("#bm-q").value;
		const qTerms = [...new Set(L.tokenizeDocument(q))];
		const color = (t) => TERM_COLORS[qTerms.indexOf(t) % TERM_COLORS.length];
		$("#bm-legend").innerHTML = qTerms
			.map(
				(t) => `<span><i style="background:${color(t)}"></i>${esc(t)}</span>`,
			)
			.join("");
		const res = L.bm25Search(idx, q, { k1, b });
		$("#bm-res").innerHTML = rankRows(res, {
			click: true,
			sel,
			sub: (r) =>
				`길이 ${idx.docLen.get(r.id)} · ${r.terms.map((t) => `${esc(t.term)} tf=${t.tf}`).join(", ")}`,
			terms: (r) =>
				r.terms.map((t) => ({ value: t.score, color: color(t.term) })),
		});
		const proj = L.projectSearch(idx, q);
		$("#bm-proj").innerHTML = rankRows(proj, {
			sub: (r) => `맞은 질의 토큰 ${r.matched}개`,
			terms: (r) =>
				r.terms.map((t) => ({
					value: t.idf,
					color: color(L.queryTokenVariants(t.term).trimmed) || "var(--accent)",
				})),
		});
		const hit = res.find((r) => r.id === sel) ?? res[0];
		if (!hit) {
			$("#bm-calc").innerHTML = "";
			return;
		}
		sel = hit.id;
		const dl = idx.docLen.get(hit.id);
		const lines = [
			`문서 ${hit.id}   |D| = ${dl}, avgdl = ${fx(idx.avgdl, 2)}, N = ${idx.N}, k1 = ${k1}, b = ${b}`,
		];
		for (const t of hit.terms) {
			lines.push(
				``,
				`── "${t.term}"   tf = ${t.tf},  n(q) = ${t.n}`,
				`   IDF      = ln(1 + (${t.N} − ${t.n} + 0.5) / (${t.n} + 0.5))      = ${fx(t.idf)}`,
				`   길이 보정 = 1 − ${b} + ${b} × ${dl} / ${fx(idx.avgdl, 2)}             = ${fx(t.norm)}`,
				`   분수      = ${t.tf} × ${fx(k1 + 1, 2)} / (${t.tf} + ${k1} × ${fx(t.norm)})   = ${fx(t.tfPart)}`,
				`   기여      = ${fx(t.idf)} × ${fx(t.tfPart)}                          = ${fx(t.score)}`,
			);
		}
		lines.push(``, `합계 = ${fx(hit.score)}`);
		$("#bm-calc").innerHTML =
			`<div class="calc">${esc(lines.join("\n"))}</div>`;
	};
	$("#bm-res").addEventListener("click", (e) => {
		const row = e.target.closest(".rank-row");
		if (row) {
			sel = row.dataset.id;
			run();
		}
	});
	$("#bm-docs").addEventListener("input", run);
	$("#bm-q").addEventListener("input", run);
	bindRange("bm-k1", run);
	bindRange("bm-b", run);
	$$("[data-bm]").forEach((btn) =>
		btn.addEventListener("click", () => {
			const [k1, b] = btn.dataset.bm.split(",");
			$("#bm-k1").value = k1;
			$("#bm-b").value = b;
			$("#bm-k1-o").textContent = k1;
			$("#bm-b-o").textContent = b;
			run();
		}),
	);
	run();
}

/* ------------------------------------------------------------ Dense 그림과 실습 */
function drawVectorFigs() {
	const sp = $("#sparse-cells");
	const on = new Set([3, 17, 18, 41]);
	for (let i = 0; i < 58; i++) {
		sp.append(
			svgEl("rect", {
				x: 10 + i * 11.6,
				y: 58,
				width: 10,
				height: 30,
				rx: 2,
				style: `fill:${on.has(i) ? "var(--accent)" : "var(--surface2)"};stroke:var(--line)`,
			}),
		);
	}
	sp.append(
		svgEl(
			"text",
			{ x: 690, y: 78, "font-size": 12, class: "muted" },
			"… 수십만 칸",
		),
	);
	[
		["lancedb", 3],
		["색인", 17],
		["다시", 18],
		["ivf", 41],
	].forEach(([w, i]) =>
		sp.append(
			svgEl(
				"text",
				{
					x: 15 + i * 11.6,
					y: 104,
					"font-size": 11,
					fill: "var(--accent)",
					"text-anchor": "middle",
				},
				w,
			),
		),
	);
	const dn = $("#dense-cells");
	const rand = L.mulberry32(7);
	for (let i = 0; i < 58; i++) {
		const v = rand() * 2 - 1;
		dn.append(
			svgEl("rect", {
				x: 10 + i * 11.6,
				y: 160,
				width: 10,
				height: 30,
				rx: 2,
				style: `fill:${v > 0 ? "var(--green)" : "var(--purple)"};opacity:${0.25 + Math.abs(v) * 0.75}`,
			}),
		);
	}
	dn.append(
		svgEl(
			"text",
			{ x: 690, y: 180, "font-size": 12, class: "muted" },
			"… 384칸",
		),
	);

	const g = $("#pool-fig");
	const row = (y, n, label) => {
		g.append(
			svgEl(
				"text",
				{ x: 10, y: y + 18, "font-size": 13, "font-weight": 700 },
				label,
			),
		);
		const w = Math.min(22, 440 / n);
		for (let i = 0; i < n; i++) {
			const key = i < 3;
			g.append(
				svgEl("rect", {
					x: 150 + i * w,
					y,
					width: w - 3,
					height: 28,
					rx: 3,
					style: `fill:${key ? "var(--amber)" : "var(--surface2)"};stroke:var(--line)`,
				}),
			);
		}
		g.append(
			svgEl("path", {
				d: `M${150 + n * w + 8} ${y + 14} H630`,
				class: "arrow",
			}),
		);
		g.append(
			svgEl(
				"text",
				{
					x: 600,
					y: y - 4,
					"font-size": 11,
					class: "muted",
					"text-anchor": "middle",
				},
				"평균",
			),
		);
		g.append(
			svgEl("rect", {
				x: 640,
				y: y - 2,
				width: 120,
				height: 32,
				rx: 6,
				style: "fill:var(--surface2);stroke:var(--line)",
			}),
		);
		g.append(
			svgEl("rect", {
				x: 640,
				y: y - 2,
				width: 120,
				height: 32,
				rx: 6,
				style: `fill:var(--amber);opacity:${(3 / n).toFixed(2)}`,
			}),
		);
		g.append(
			svgEl(
				"text",
				{ x: 700, y: y + 19, "font-size": 12, "text-anchor": "middle" },
				`핵심 신호 ${Math.round((3 / n) * 100)}%`,
			),
		);
	};
	row(30, 5, "짧은 입력 (5토큰)");
	row(120, 20, "긴 입력 (20토큰)");

	const pq = $("#pq-fig");
	for (let i = 0; i < 8; i++) {
		pq.append(
			svgEl("rect", {
				x: 10 + i * 70,
				y: 34,
				width: 66,
				height: 30,
				rx: 4,
				style: `fill:${TERM_COLORS[i % 6]};opacity:.35;stroke:var(--line)`,
			}),
		);
		pq.append(
			svgEl(
				"text",
				{ x: 43 + i * 70, y: 54, "font-size": 11, "text-anchor": "middle" },
				`조각 ${i + 1}`,
			),
		);
		pq.append(svgEl("path", { d: `M${43 + i * 70} 66 V92`, class: "arrow" }));
		pq.append(
			svgEl("rect", {
				x: 20 + i * 70,
				y: 98,
				width: 46,
				height: 28,
				rx: 4,
				class: "node",
			}),
		);
		pq.append(
			svgEl(
				"text",
				{
					x: 43 + i * 70,
					y: 117,
					"font-size": 12,
					"text-anchor": "middle",
					class: "mono",
				},
				[17, 203, 5, 88, 140, 61, 9, 230][i],
			),
		);
	}
	pq.append(
		svgEl(
			"text",
			{ x: 580, y: 54, "font-size": 12, class: "muted" },
			"… 96조각",
		),
	);
	pq.append(
		svgEl(
			"text",
			{ x: 580, y: 117, "font-size": 12, class: "muted" },
			"코드북 번호만 저장",
		),
	);
}
const DENSE_DOCS = [
	{ id: "자동차 수리 기록", deg: 15 },
	{ id: "엔진 오일 교체", deg: 38 },
	{ id: "토마토 파스타 레시피", deg: 118 },
	{ id: "김치찌개 끓이는 법", deg: 142 },
	{ id: "LanceDB 오류 E1102 해결", deg: 258 },
	{ id: "LanceDB 색인 구조", deg: 286 },
];
const DENSE_Q = [
	{ text: "차량 정비 방법", deg: 25 },
	{ text: "요리 레시피 추천", deg: 130 },
	{ text: "LanceDB 오류 E1102", deg: 278 },
];
function initDenseLab() {
	const svg = $("#dense-svg");
	const R = 130;
	let qDeg = DENSE_Q[0].deg;
	let qText = DENSE_Q[0].text;
	const idx = L.buildIndex(DENSE_DOCS.map((d) => ({ id: d.id, text: d.id })));
	const pt = (deg, r) => [
		Math.cos((deg * Math.PI) / 180) * r,
		-Math.sin((deg * Math.PI) / 180) * r,
	];
	const draw = () => {
		svg.innerHTML = "";
		svg.append(
			svgEl("circle", {
				cx: 0,
				cy: 0,
				r: R,
				fill: "none",
				stroke: "var(--line)",
			}),
		);
		svg.append(
			svgEl("line", { x1: -R - 10, x2: R + 10, y1: 0, y2: 0, class: "grid" }),
		);
		svg.append(
			svgEl("line", { y1: -R - 10, y2: R + 10, x1: 0, x2: 0, class: "grid" }),
		);
		for (const d of DENSE_DOCS) {
			const [x, y] = pt(d.deg, R);
			svg.append(
				svgEl("line", {
					x1: 0,
					y1: 0,
					x2: x,
					y2: y,
					stroke: "var(--muted)",
					"stroke-width": 1.6,
				}),
			);
			svg.append(svgEl("circle", { cx: x, cy: y, r: 4, fill: "var(--muted)" }));
			const [lx, ly] = pt(d.deg, R + 12);
			svg.append(
				svgEl(
					"text",
					{
						x: lx,
						y: ly + 4,
						"font-size": 10.5,
						"text-anchor": lx > 5 ? "start" : lx < -5 ? "end" : "middle",
						class: "muted",
					},
					d.id,
				),
			);
		}
		const [qx, qy] = pt(qDeg, R);
		svg.append(
			svgEl("line", {
				x1: 0,
				y1: 0,
				x2: qx,
				y2: qy,
				stroke: "var(--amber)",
				"stroke-width": 3,
			}),
		);
		svg.append(
			svgEl("circle", {
				cx: qx,
				cy: qy,
				r: 10,
				fill: "var(--amber)",
				style: "cursor:grab",
				id: "dq-handle",
			}),
		);
		svg.append(
			svgEl(
				"text",
				{
					x: 0,
					y: R + 40,
					"text-anchor": "middle",
					"font-size": 12,
					fill: "var(--amber)",
				},
				`질의: "${qText}"`,
			),
		);
		const cos = DENSE_DOCS.map((d) => ({
			id: d.id,
			score: Math.cos(((d.deg - qDeg) * Math.PI) / 180),
		})).sort((a, b) => b.score - a.score);
		$("#dense-cos").innerHTML = rankRows(cos.slice(0, 4), { max: 1 });
		const bm = L.bm25Search(idx, qText);
		$("#dense-bm").innerHTML = bm.length
			? rankRows(bm, {
					sub: (r) =>
						`맞은 단어: ${r.terms.map((t) => esc(t.term)).join(", ")}`,
				})
			: `<div class="empty">같은 단어가 들어 있는 문서가 없음 → BM25는 0개</div>`;
	};
	let dragging = false;
	const move = (e) => {
		const m = svg.getScreenCTM();
		if (!m) return;
		const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
		qDeg = (Math.atan2(-p.y, p.x) * 180) / Math.PI;
		draw();
	};
	svg.addEventListener("pointerdown", (e) => {
		dragging = true;
		svg.setPointerCapture(e.pointerId);
		move(e);
	});
	svg.addEventListener("pointermove", (e) => dragging && move(e));
	svg.addEventListener("pointerup", () => (dragging = false));
	$$("[data-dq]").forEach((b) =>
		b.addEventListener("click", () => {
			const q = DENSE_Q[+b.dataset.dq];
			qDeg = q.deg;
			qText = q.text;
			draw();
		}),
	);
	draw();
}

/* ------------------------------------------------------------ IVF 실습 */
function initIvfLab() {
	const cv = $("#iv-canvas");
	const ctx = cv.getContext("2d");
	const S = 460;
	const dpr = window.devicePixelRatio || 1;
	cv.width = S * dpr;
	cv.height = S * dpr;
	cv.style.width = `${S}px`;
	ctx.scale(dpr, dpr);
	const rand = L.mulberry32(11);
	const gauss = () =>
		Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
	const centers = Array.from({ length: 7 }, () => [
		0.12 + rand() * 0.76,
		0.12 + rand() * 0.76,
	]);
	const pts = [];
	for (let i = 0; i < 600; i++) {
		if (i % 6 === 0) pts.push([rand(), rand()]);
		else {
			const c = centers[i % centers.length];
			pts.push([
				Math.min(1, Math.max(0, c[0] + gauss() * 0.07)),
				Math.min(1, Math.max(0, c[1] + gauss() * 0.07)),
			]);
		}
	}
	let seed = 1;
	let ivf = null;
	let q = [0.5, 0.5];
	const css = (v) =>
		getComputedStyle(document.documentElement).getPropertyValue(v).trim();
	const hue = (i) => (i * 137.508) % 360;
	const rebuild = () => {
		ivf = L.buildIvf(pts, +$("#iv-p").value, seed);
		$("#iv-n").max = $("#iv-p").value;
		if (+$("#iv-n").value > +$("#iv-p").value)
			$("#iv-n").value = $("#iv-p").value;
		$("#iv-n-o").textContent = $("#iv-n").value;
		curve();
		draw();
	};
	let curveData = [];
	const curve = () => {
		const r2 = L.mulberry32(99);
		const qs = Array.from({ length: 60 }, () => {
			const p = pts[Math.floor(r2() * pts.length)];
			return [p[0] + (r2() - 0.5) * 0.05, p[1] + (r2() - 0.5) * 0.05];
		});
		const P = ivf.centroids.length;
		curveData = [];
		for (let n = 1; n <= P; n++) {
			let s = 0;
			for (const qq of qs) {
				const ex = new Set(L.exactTopK(pts, qq, 10));
				s +=
					L.ivfSearch(ivf, qq, 10, n).top.filter((i) => ex.has(i)).length / 10;
			}
			curveData.push(s / qs.length);
		}
	};
	const drawCurve = (cur) => {
		const svg = $("#iv-curve");
		svg.innerHTML = "";
		const P = curveData.length;
		const X = (n) => 34 + ((n - 1) / Math.max(1, P - 1)) * 310;
		const Y = (v) => 150 - v * 130;
		[0, 0.5, 1].forEach((v) => {
			svg.append(
				svgEl("line", { x1: 34, x2: 344, y1: Y(v), y2: Y(v), class: "grid" }),
			);
			svg.append(
				svgEl(
					"text",
					{
						x: 28,
						y: Y(v) + 4,
						"font-size": 11,
						"text-anchor": "end",
						class: "muted",
					},
					v,
				),
			);
		});
		svg.append(
			svgEl("path", {
				d: curveData
					.map((v, i) => `${i ? "L" : "M"}${X(i + 1)},${Y(v)}`)
					.join(""),
				fill: "none",
				stroke: "var(--accent)",
				"stroke-width": 2.2,
			}),
		);
		svg.append(
			svgEl("circle", {
				cx: X(cur),
				cy: Y(curveData[cur - 1]),
				r: 5,
				fill: "var(--amber)",
			}),
		);
		svg.append(
			svgEl(
				"text",
				{
					x: 189,
					y: 174,
					"font-size": 11,
					"text-anchor": "middle",
					class: "muted",
				},
				`nprobes (1 ~ ${P})`,
			),
		);
		svg.append(
			svgEl(
				"text",
				{
					x: Math.min(300, X(cur) + 8),
					y: Y(curveData[cur - 1]) - 8,
					"font-size": 11,
					fill: "var(--amber)",
				},
				fx(curveData[cur - 1], 2),
			),
		);
	};
	const draw = () => {
		const n = +$("#iv-n").value;
		const res = L.ivfSearch(ivf, q, 10, n);
		const probed = new Set(res.probes);
		const exact = L.exactTopK(pts, q, 10);
		const found = new Set(res.top);
		const dark = document.documentElement.dataset.theme !== "light";
		ctx.clearRect(0, 0, S, S);
		const cell = 6;
		for (let y = 0; y < S; y += cell) {
			for (let x = 0; x < S; x += cell) {
				const p = [(x + cell / 2) / S, (y + cell / 2) / S];
				let best = 0;
				let bd = Infinity;
				ivf.centroids.forEach((c, i) => {
					const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2;
					if (d < bd) (bd = d), (best = i);
				});
				ctx.fillStyle = `hsla(${hue(best)},60%,${dark ? 45 : 60}%,${probed.has(best) ? 0.22 : 0.05})`;
				ctx.fillRect(x, y, cell, cell);
			}
		}
		pts.forEach((p, i) => {
			const part = ivf.assign[i];
			ctx.fillStyle = `hsla(${hue(part)},70%,${dark ? 65 : 40}%,${probed.has(part) ? 0.95 : 0.22})`;
			ctx.beginPath();
			ctx.arc(p[0] * S, p[1] * S, found.has(i) ? 4.5 : 2.4, 0, Math.PI * 2);
			ctx.fill();
		});
		for (const i of exact) {
			ctx.strokeStyle = found.has(i) ? css("--text") : css("--red");
			ctx.lineWidth = found.has(i) ? 1.5 : 2.5;
			ctx.beginPath();
			ctx.arc(pts[i][0] * S, pts[i][1] * S, 7.5, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.strokeStyle = css("--text");
		ctx.lineWidth = 1.5;
		ivf.centroids.forEach((c) => {
			const [x, y] = [c[0] * S, c[1] * S];
			ctx.beginPath();
			ctx.moveTo(x - 4, y - 4);
			ctx.lineTo(x + 4, y + 4);
			ctx.moveTo(x + 4, y - 4);
			ctx.lineTo(x - 4, y + 4);
			ctx.stroke();
		});
		ctx.fillStyle = css("--amber");
		ctx.beginPath();
		const [qx, qy] = [q[0] * S, q[1] * S];
		for (let k = 0; k < 10; k++) {
			const r = k % 2 ? 4 : 10;
			const a = (Math.PI / 5) * k - Math.PI / 2;
			ctx.lineTo(qx + Math.cos(a) * r, qy + Math.sin(a) * r);
		}
		ctx.fill();
		const recall = exact.filter((i) => found.has(i)).length / 10;
		$("#iv-stats").innerHTML = `
			<div class="stat"><b>${fx(recall, 1)}</b><span>Recall@10</span></div>
			<div class="stat"><b style="color:${recall < 1 ? "var(--red)" : "inherit"}">${10 - Math.round(recall * 10)}</b><span>놓친 정답 (빨간 원)</span></div>
			<div class="stat"><b>${res.scanned}<small style="font-size:13px;color:var(--muted)"> / ${pts.length}</small></b><span>거리를 잰 점 (${Math.round((res.scanned / pts.length) * 100)}%)</span></div>
			<div class="stat"><b>${seed}</b><span>k-means 시드</span></div>`;
		drawCurve(n);
	};
	cv.addEventListener("pointerdown", (e) => {
		const r = cv.getBoundingClientRect();
		q = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
		draw();
	});
	bindRange("iv-p", rebuild);
	bindRange("iv-n", draw);
	$("#iv-re").addEventListener("click", () => {
		seed++;
		rebuild();
	});
	$("#theme-btn").addEventListener("click", () => setTimeout(draw, 0));
	rebuild();
}

/* ------------------------------------------------------------ RRF 실습 */
function initRrfLab() {
	$("#rr-a").value = [
		"tailwind-merge 설치 | 12.4",
		"nextjs 라우팅 | 3.1",
		"검색 개선 계획 | 2.9",
		"LanceDB 노트 | 1.2",
	].join("\n");
	$("#rr-b").value = [
		"검색 개선 계획 | 0.62",
		"임베딩 모델 비교 | 0.60",
		"nextjs 라우팅 | 0.58",
		"청킹 실험 | 0.41",
	].join("\n");
	const parse = (t) =>
		t
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean)
			.map((l) => {
				const [id, s] = l.split("|").map((x) => x.trim());
				return { id, score: Number.parseFloat(s) || 0 };
			});
	const run = () => {
		const A = parse($("#rr-a").value);
		const B = parse($("#rr-b").value);
		const k = +$("#rr-k").value;
		const w = [+$("#rr-wa").value, +$("#rr-wb").value];
		const fused = L.rrf([A.map((x) => x.id), B.map((x) => x.id)], k, w);
		const name = ["키워드", "벡터"];
		$("#rr-out").innerHTML = rankRows(fused, {
			sub: (r) =>
				r.parts
					.map((p) => `${name[p.list]} ${p.rank}위 → ${fx(p.value, 4)}`)
					.join(" + "),
			terms: (r) =>
				r.parts.map((p) => ({
					value: p.value,
					color: p.list ? "var(--green)" : "var(--amber)",
				})),
		}).replace(
			/<span class="s">([\d.]+)<\/span>/g,
			(_, v) => `<span class="s">${Number(v).toFixed(4)}</span>`,
		);
		const raw = new Map();
		[A, B].forEach((list, li) =>
			list.forEach(({ id, score }) => {
				if (!raw.has(id)) raw.set(id, { id, score: 0, parts: [] });
				const r = raw.get(id);
				r.score += w[li] * score;
				r.parts.push({ list: li, value: w[li] * score });
			}),
		);
		const rawList = [...raw.values()].sort((a, b) => b.score - a.score);
		$("#rr-raw").innerHTML = rankRows(rawList, {
			terms: (r) =>
				r.parts.map((p) => ({
					value: p.value,
					color: p.list ? "var(--green)" : "var(--amber)",
				})),
		});
		$("#rr-mm").innerHTML = rankRows(L.minMaxFuse([A, B], w));
	};
	["rr-a", "rr-b"].forEach((id) => $(`#${id}`).addEventListener("input", run));
	bindRange("rr-k", run);
	bindRange("rr-wa", run);
	bindRange("rr-wb", run);
	run();
}

/* ------------------------------------------------------------ 청킹 그림과 실습 */
function drawChunkStrategies() {
	const svg = $("#chunk-strategies");
	const X0 = 170;
	const W = 610;
	const paras = [0, 80, 150, 255, 330, 440, 520, 610];
	const heads = [0, 255, 440];
	const x = (v) => X0 + v;
	const colors = [
		"var(--accent)",
		"var(--green)",
		"var(--purple)",
		"var(--amber)",
	];
	let y = 14;
	const label = (t, s) => {
		svg.append(
			svgEl(
				"text",
				{ x: 10, y: y + 17, "font-size": 13.5, "font-weight": 700 },
				t,
			),
		);
		if (s)
			svg.append(
				svgEl("text", { x: 10, y: y + 33, "font-size": 11, class: "muted" }, s),
			);
	};
	const marks = (yy, h) => {
		paras.slice(1, -1).forEach((p) =>
			svg.append(
				svgEl("line", {
					x1: x(p),
					x2: x(p),
					y1: yy - 3,
					y2: yy + h + 3,
					stroke: "var(--faint)",
					"stroke-width": 1,
				}),
			),
		);
		heads.forEach((p) =>
			svg.append(
				svgEl("line", {
					x1: x(p),
					x2: x(p),
					y1: yy - 5,
					y2: yy + h + 5,
					stroke: "var(--text)",
					"stroke-width": 2.5,
				}),
			),
		);
	};
	const blocks = (segs, h = 22, yy = y + 6, opts = {}) => {
		segs.forEach(([a, b], i) =>
			svg.append(
				svgEl("rect", {
					x: x(a) + 1,
					y: yy,
					width: b - a - 2,
					height: h,
					rx: 4,
					style: `fill:${colors[i % 4]};opacity:${opts.op ?? 0.45}`,
				}),
			),
		);
	};
	label("원문", "가는 선 문단, 굵은 선 제목");
	svg.append(
		svgEl("rect", {
			x: x(0),
			y: y + 6,
			width: W,
			height: 22,
			rx: 4,
			class: "node",
		}),
	);
	marks(y + 6, 22);
	["H1", "H2", "H2"].forEach((t, i) =>
		svg.append(
			svgEl(
				"text",
				{ x: x(heads[i]) + 5, y: y + 22, "font-size": 11, class: "muted" },
				t,
			),
		),
	);
	y += 52;
	label("고정 크기", "문단 중간에서 잘림");
	blocks([
		[0, 120],
		[120, 240],
		[240, 360],
		[360, 480],
		[480, 610],
	]);
	marks(y + 6, 22);
	y += 52;
	label("재귀 분할", "문단 경계 우선, 크기 안에서 합침");
	blocks([
		[0, 150],
		[140, 255],
		[255, 330],
		[322, 440],
		[440, 610],
	]);
	[
		[140, 150],
		[322, 330],
	].forEach(([a, b]) =>
		svg.append(
			svgEl("rect", {
				x: x(a),
				y: y + 6,
				width: b - a,
				height: 22,
				class: "cov",
			}),
		),
	);
	marks(y + 6, 22);
	y += 52;
	label("제목 기준", "섹션 길이가 들쑥날쑥");
	blocks([
		[0, 255],
		[255, 440],
		[440, 610],
	]);
	marks(y + 6, 22);
	y += 52;
	label("의미 기반", "인접 문장 유사도가 떨어지는 곳");
	blocks([
		[0, 205],
		[205, 380],
		[380, 610],
	]);
	let d = "";
	for (let i = 0; i <= 610; i += 5)
		d += `${i ? "L" : "M"}${x(i)},${y + 30 - (Math.cos(i / 32) * 0.5 + 0.5) * 6 - (Math.abs(i - 205) < 18 || Math.abs(i - 380) < 18 ? -8 : 0)}`;
	svg.append(
		svgEl("path", {
			d,
			fill: "none",
			stroke: "var(--red)",
			"stroke-width": 1.4,
		}),
	);
	y += 52;
	label("parent-child", "작은 것으로 찾고 큰 것을 반환");
	blocks(
		[
			[0, 255],
			[255, 440],
			[440, 610],
		],
		26,
		y + 4,
		{ op: 0.18 },
	);
	blocks(
		[
			[10, 80],
			[90, 160],
			[170, 245],
			[265, 345],
			[355, 430],
			[450, 525],
			[535, 600],
		],
		12,
		y + 11,
		{ op: 0.75 },
	);
	y += 52;
	label("late chunking", "전체를 먼저 인코딩한 뒤 구간별 풀링");
	svg.append(
		svgEl("rect", {
			x: x(0),
			y: y + 2,
			width: W,
			height: 10,
			rx: 3,
			style: "fill:var(--cyan);opacity:.35",
		}),
	);
	svg.append(
		svgEl(
			"text",
			{ x: x(W / 2), y: y + 11, "font-size": 9.5, "text-anchor": "middle" },
			"긴 컨텍스트 모델이 문서 전체를 한 번에 봄",
		),
	);
	blocks(
		[
			[0, 150],
			[150, 330],
			[330, 440],
			[440, 610],
		],
		12,
		y + 18,
	);
	y += 52;
	label("contextual", "청크마다 LLM이 쓴 문맥을 앞에 붙임");
	blocks([
		[0, 150],
		[150, 255],
		[255, 440],
		[440, 610],
	]);
	[0, 150, 255, 440].forEach((a) => {
		svg.append(
			svgEl("rect", {
				x: x(a) + 2,
				y: y + 8,
				width: 34,
				height: 18,
				rx: 3,
				style: "fill:var(--green)",
			}),
		);
		svg.append(
			svgEl(
				"text",
				{
					x: x(a) + 19,
					y: y + 21,
					"font-size": 10,
					"text-anchor": "middle",
					style: "fill:#0b1020",
				},
				"문맥",
			),
		);
	});
}
const SAMPLE_NOTE = `# LanceDB 색인 메모

LanceDB는 벡터를 IVF-PQ로 색인한다. 파티션 수는 행 수의 제곱근으로 정했다.

## 재색인할 때 결과가 흔들리는 이유

IVF는 k-means로 파티션을 나눈다. 초기 중심이 달라지면 파티션도 달라지고, nprobes 안에 들어오는 후보가 바뀐다. 그래서 같은 데이터로 다시 색인해도 검색 결과가 조금씩 달라진다.

실험은 세 번 색인해 평균을 냈다. 하이브리드 MRR@10은 0.652에서 0.677 사이였다.

## 청크 크기

임베딩 모델은 128토큰으로 학습됐다. 처음에는 GPT 토크나이저로 500토큰씩 잘랐는데, 모델 토크나이저로 세면 중앙값이 296토큰이었다. 256으로 줄이자 벡터 검색 MRR이 올랐다.

## 할 일

- 의미 질의 12개를 따로 확인
- 정확 검색과 지연 비교`;
function initChunkLab() {
	$("#ck-text").value = SAMPLE_NOTE;
	const run = () => {
		const text = $("#ck-text").value;
		const size = +$("#ck-size").value;
		let overlap = +$("#ck-ov").value;
		if (overlap >= size) overlap = size - 1;
		const s = $("#ck-s").value;
		const fn =
			s === "fixed"
				? L.fixedChunks
				: s === "heading"
					? L.headingChunks
					: L.recursiveChunks;
		const chunks = fn(text, { size, overlap }).filter((c) => c.start >= 0);
		const useCtx = $("#ck-ctx").checked;
		const bounds = new Set([0, text.length]);
		chunks.forEach((c) => (bounds.add(c.start), bounds.add(c.end)));
		const bs = [...bounds].sort((a, b) => a - b);
		let html = "";
		for (let i = 0; i < bs.length - 1; i++) {
			const [a, b] = [bs[i], bs[i + 1]];
			const cover = chunks
				.map((c, j) => (c.start <= a && c.end >= b ? j : -1))
				.filter((j) => j >= 0);
			const seg = esc(text.slice(a, b));
			html +=
				cover.length === 0
					? seg
					: cover.length === 1
						? `<span class="c${cover[0] % 4}">${seg}</span>`
						: `<span class="cov">${seg}</span>`;
		}
		$("#ck-view").innerHTML = html;
		const lens = chunks.map((c) => c.text.length);
		const ctxLens = chunks.map((c) => {
			const cx = L.chunkContext(text, c);
			return (cx ? cx.length + 1 : 0) + c.text.length;
		});
		const avg = (xs) =>
			xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
		$("#ck-stats").innerHTML = `
			<div class="stat"><b>${chunks.length}</b><span>청크 수</span></div>
			<div class="stat"><b>${avg(lens)}</b><span>평균 길이(자)</span></div>
			<div class="stat"><b>${lens.length ? Math.min(...lens) : 0}</b><span>가장 짧은 청크</span></div>
			<div class="stat"><b style="color:${lens.filter((l) => l < 40).length ? "var(--red)" : "inherit"}">${lens.filter((l) => l < 40).length}</b><span>40자 미만 청크</span></div>
			${useCtx ? `<div class="stat"><b>${avg(ctxLens)}</b><span>문맥 포함 평균 길이</span></div><div class="stat"><b style="color:${ctxLens.some((l) => l > size) ? "var(--red)" : "inherit"}">${ctxLens.filter((l) => l > size).length}</b><span>문맥 포함 시 크기 초과</span></div>` : ""}`;
		$("#ck-list").innerHTML = chunks
			.map((c, i) => {
				const cx = useCtx ? L.chunkContext(text, c) : "";
				return `<div class="chunk"><div class="h"><span class="c${i % 4}" style="padding:0 6px;border-radius:4px;color:var(--text)">#${i + 1}</span><span>${c.text.length}자</span><span>위치 ${c.start}–${c.end}</span></div>${cx ? `<div class="ctx">${esc(cx)}</div>` : ""}<div class="body">${esc(c.text)}</div></div>`;
			})
			.join("");
	};
	["ck-text", "ck-s", "ck-ctx"].forEach((id) =>
		$(`#${id}`).addEventListener("input", run),
	);
	bindRange("ck-size", run);
	bindRange("ck-ov", run);
	run();
}
function barChart(
	svg,
	rows,
	{
		max,
		fmt = (v) => fx(v),
		w = 800,
		labelW = 200,
		colors = ["var(--faint)", "var(--accent)"],
	},
) {
	svg.innerHTML = "";
	const rowH = 36;
	const X = (v) => labelW + (v / max) * (w - labelW - 70);
	rows.forEach((r, i) => {
		const y = 16 + i * rowH;
		svg.append(
			svgEl(
				"text",
				{ x: 10, y: y + 12, "font-size": 12.5, "font-weight": 700 },
				r.label,
			),
		);
		if (r.sub)
			svg.append(
				svgEl(
					"text",
					{ x: 10, y: y + 27, "font-size": 11, class: "muted" },
					r.sub,
				),
			);
		r.values.forEach((v, j) => {
			const yy = y + j * 13;
			svg.append(
				svgEl("rect", {
					x: labelW,
					y: yy,
					width: Math.max(1, X(v) - labelW),
					height: 11,
					rx: 3,
					style: `fill:${colors[j]}`,
				}),
			);
			svg.append(
				svgEl(
					"text",
					{ x: X(v) + 6, y: yy + 10, "font-size": 11, class: j ? "" : "muted" },
					`${fmt(v)}${r.names ? ` ${r.names[j]}` : ""}`,
				),
			);
		});
	});
}
function drawStaticCharts() {
	barChart(
		$("#story-fig"),
		[
			{
				label: "① 평가셋",
				sub: "MRR@10",
				values: [0.381, 0.595],
				names: ["현재 동작", "키워드만"],
			},
			{ label: "② 접두사 제거", sub: "벡터 Recall@5", values: [0.127, 0.48] },
			{
				label: "③ 리랭커",
				sub: "MRR@10",
				values: [0.579, 0.672],
				names: ["있음", "없음"],
			},
			{ label: "④ 실제 경로", sub: "Recall@5", values: [0.516, 0.752] },
			{ label: "④ 실제 경로", sub: "MRR@10", values: [0.381, 0.672] },
			{ label: "⑥ 청크 256/32", sub: "벡터 MRR@10", values: [0.325, 0.456] },
			{ label: "⑦ 질의 토큰화", sub: "Recall@5", values: [0.752, 0.8] },
			{ label: "⑦ 질의 토큰화", sub: "MRR@10", values: [0.65, 0.711] },
		],
		{ max: 1 },
	);
	const sz = $("#size-fig");
	const cfg = [
		["cl100k 500/50", 0.325, 3615],
		["model 500/50", 0.341, 2462],
		["model 256/32 ✓", 0.456, 5159],
		["model 128/16", 0.456, 12066],
		["256/32 제목", 0.436, 6238],
	];
	sz.innerHTML = "";
	const Y = (v) => 210 - (v / 0.5) * 180;
	const Y2 = (v) => 210 - (v / 13000) * 180;
	[0, 0.25, 0.5].forEach((v) => {
		sz.append(
			svgEl("line", { x1: 60, x2: 660, y1: Y(v), y2: Y(v), class: "grid" }),
		);
		sz.append(
			svgEl(
				"text",
				{
					x: 54,
					y: Y(v) + 4,
					"font-size": 11,
					"text-anchor": "end",
					class: "muted",
				},
				v,
			),
		);
	});
	sz.append(
		svgEl(
			"text",
			{ x: 666, y: Y2(12066) + 4, "font-size": 11, fill: "var(--amber)" },
			"청크 수",
		),
	);
	cfg.forEach(([name, mrr, n], i) => {
		const cx = 110 + i * 120;
		sz.append(
			svgEl("rect", {
				x: cx - 30,
				y: Y(mrr),
				width: 60,
				height: 210 - Y(mrr),
				rx: 4,
				style: `fill:var(--accent);opacity:${i === 2 ? 1 : 0.5}`,
			}),
		);
		sz.append(
			svgEl(
				"text",
				{ x: cx, y: Y(mrr) - 6, "font-size": 12, "text-anchor": "middle" },
				mrr.toFixed(3),
			),
		);
		sz.append(
			svgEl(
				"text",
				{
					x: cx,
					y: 230,
					"font-size": 11.5,
					"text-anchor": "middle",
					class: i === 2 ? "" : "muted",
				},
				name,
			),
		);
		sz.append(svgEl("circle", { cx, cy: Y2(n), r: 5, fill: "var(--amber)" }));
		sz.append(
			svgEl(
				"text",
				{ x: cx + 9, y: Y2(n) + 4, "font-size": 10.5, fill: "var(--amber)" },
				n.toLocaleString(),
			),
		);
	});
	sz.append(
		svgEl(
			"text",
			{ x: 60, y: 252, "font-size": 11, class: "muted" },
			"막대: 벡터만 MRR@10 (0~0.5)   점: 청크 수",
		),
	);

	const cr = $("#cr-fig");
	const data = [
		["기준 (embedding)", 5.7, ""],
		["+ contextual embedding", 3.7, "−35%"],
		["+ contextual BM25", 2.9, "−49%"],
		["+ 리랭킹", 1.9, "−67%"],
	];
	data.forEach(([name, v, d], i) => {
		const y = 18 + i * 44;
		cr.append(svgEl("text", { x: 10, y: y + 15, "font-size": 12.5 }, name));
		cr.append(
			svgEl("rect", {
				x: 200,
				y,
				width: (v / 6) * 360,
				height: 22,
				rx: 4,
				style: `fill:${i ? "var(--green)" : "var(--faint)"};opacity:${0.4 + i * 0.2}`,
			}),
		);
		cr.append(
			svgEl(
				"text",
				{ x: 206 + (v / 6) * 360, y: y + 16, "font-size": 12 },
				`${v}% ${d}`,
			),
		);
	});
}

/* ------------------------------------------------------------ 지표 실습 */
function initMetricsLab() {
	const grades = [0, 1, 0, 0, 2, 0, 0, 0, 0, 0];
	const run = () => {
		$("#mt-slots").innerHTML = grades
			.map(
				(g, i) =>
					`<div class="slot g${g}" data-i="${i}"><span><b>${i + 1}</b>${g ? `관련 ${g}` : "무관"}</span></div>`,
			)
			.join("");
		const found = grades.filter((g) => g > 0).length;
		const totalEl = $("#mt-total");
		if (+totalEl.value < found) totalEl.value = found;
		const total = +totalEl.value;
		const ranked = grades.map((_, i) => `r${i}`);
		const rel = new Set(ranked.filter((_, i) => grades[i] > 0));
		const gmap = new Map(
			ranked
				.filter((_, i) => grades[i] > 0)
				.map((id) => [id, grades[+id.slice(1)]]),
		);
		for (let i = 0; i < total - found; i++) {
			rel.add(`miss${i}`);
			gmap.set(`miss${i}`, 1);
		}
		const st = [
			["Recall@5", L.recallAtK(ranked, rel, 5)],
			["Recall@10", L.recallAtK(ranked, rel, 10)],
			["Hit@1", L.hitAt1(ranked, rel)],
			["MRR@10", L.reciprocalRank(ranked, rel, 10)],
			["nDCG@10", L.ndcgAtK(ranked, gmap, 10)],
		];
		$("#mt-stats").innerHTML = st
			.map(
				([n, v]) => `<div class="stat"><b>${fx(v)}</b><span>${n}</span></div>`,
			)
			.join("");
	};
	$("#mt-slots").addEventListener("click", (e) => {
		const s = e.target.closest(".slot");
		if (!s) return;
		grades[+s.dataset.i] = (grades[+s.dataset.i] + 1) % 3;
		run();
	});
	$("#mt-total").addEventListener("input", run);
	run();
}
function initBootLab() {
	$("#bt-a").value =
		"1, 0.5, 0, 1, 0.33, 0, 1, 0.25, 0.5, 1, 0, 0.2, 1, 0.5, 0, 1, 0.33, 0.5, 0, 1";
	$("#bt-b").value =
		"1, 1, 0.5, 1, 0.5, 0, 0.5, 0.5, 0.5, 1, 0.33, 0.33, 1, 1, 0, 1, 0, 0.5, 0.25, 1";
	const nums = (s) =>
		s
			.split(/[,\s]+/)
			.map(Number.parseFloat)
			.filter(Number.isFinite);
	const run = () => {
		let a = nums($("#bt-a").value);
		let b = nums($("#bt-b").value);
		const n = Math.min(a.length, b.length);
		if (n < 2) {
			$("#bt-stats").innerHTML =
				`<div class="empty">두 줄에 같은 개수의 숫자를 2개 이상 적으세요</div>`;
			$("#bt-hist").innerHTML = "";
			return;
		}
		a = a.slice(0, n);
		b = b.slice(0, n);
		const x = +$("#bt-x").value;
		const A = Array.from({ length: x }, () => a).flat();
		const B = Array.from({ length: x }, () => b).flat();
		const iters = 4000;
		const r = L.pairedBootstrap(A, B, { iters });
		const sig = r.lo > 0 || r.hi < 0;
		$("#bt-stats").innerHTML = `
			<div class="stat"><b>${A.length}</b><span>질의 수</span></div>
			<div class="stat"><b>${r.meanDiff >= 0 ? "+" : ""}${fx(r.meanDiff)}</b><span>평균 차이 (B − A)</span></div>
			<div class="stat"><b>[${fx(r.lo)}, ${fx(r.hi)}]</b><span>95% 신뢰구간</span></div>
			<div class="stat"><b style="color:${sig ? "var(--green)" : "var(--amber)"}">${sig ? "유의" : "단정 불가"}</b><span>${sig ? "구간이 0을 포함하지 않음" : "구간이 0을 포함"}</span></div>`;
		const diffs = A.map((v, i) => B[i] - v);
		const rand = L.mulberry32(42);
		const means = [];
		for (let it = 0; it < iters; it++) {
			let s = 0;
			for (let j = 0; j < diffs.length; j++)
				s += diffs[Math.floor(rand() * diffs.length)];
			means.push(s / diffs.length);
		}
		const lo = Math.min(...means, 0) - 0.01;
		const hi = Math.max(...means, 0) + 0.01;
		const bins = new Array(40).fill(0);
		means.forEach(
			(m) => bins[Math.min(39, Math.floor(((m - lo) / (hi - lo)) * 40))]++,
		);
		const svg = $("#bt-hist");
		svg.innerHTML = "";
		const X = (v) => 30 + ((v - lo) / (hi - lo)) * 580;
		const top = Math.max(...bins);
		bins.forEach((c, i) => {
			const v = lo + ((i + 0.5) / 40) * (hi - lo);
			const inside = v >= r.lo && v <= r.hi;
			svg.append(
				svgEl("rect", {
					x: 30 + i * 14.5,
					y: 160 - (c / top) * 140,
					width: 13,
					height: (c / top) * 140,
					style: `fill:var(--accent);opacity:${inside ? 0.85 : 0.3}`,
				}),
			);
		});
		svg.append(
			svgEl("line", {
				x1: X(0),
				x2: X(0),
				y1: 10,
				y2: 166,
				stroke: "var(--red)",
				"stroke-width": 2,
			}),
		);
		svg.append(
			svgEl(
				"text",
				{ x: X(0) + 4, y: 22, "font-size": 11, fill: "var(--red)" },
				"0 (차이 없음)",
			),
		);
		svg.append(
			svgEl("line", { x1: 30, x2: 610, y1: 160, y2: 160, class: "axis" }),
		);
		[lo, hi].forEach((v, i) =>
			svg.append(
				svgEl(
					"text",
					{
						x: i ? 610 : 30,
						y: 180,
						"font-size": 11,
						"text-anchor": i ? "end" : "start",
						class: "muted",
					},
					fx(v, 2),
				),
			),
		);
		svg.append(
			svgEl(
				"text",
				{
					x: 320,
					y: 196,
					"font-size": 11,
					"text-anchor": "middle",
					class: "muted",
				},
				"재표본 평균 차이의 분포 (진한 막대 = 95% 구간)",
			),
		);
	};
	["bt-a", "bt-b"].forEach((id) => $(`#${id}`).addEventListener("input", run));
	bindRange("bt-x", run, (v) => `×${v}`);
	run();
}

/* ------------------------------------------------------------ 시작 */
$("#qa-open").addEventListener("click", () =>
	$$("#m-drill details").forEach((d) => (d.open = true)),
);
$("#qa-close").addEventListener("click", () =>
	$$("#m-drill details").forEach((d) => (d.open = false)),
);
buildNav();
addFooters();
refreshProgress();
renderCodeFiles();
const inits = [
	initMiniRag,
	initIndexLab,
	initBm25Chart,
	initBm25Lab,
	drawVectorFigs,
	initDenseLab,
	initIvfLab,
	initRrfLab,
	drawChunkStrategies,
	initChunkLab,
	drawStaticCharts,
	initMetricsLab,
	initBootLab,
];
for (const f of inits) {
	try {
		f();
	} catch (err) {
		console.error(f.name, err);
	}
}
route();
