#!/usr/bin/env node
// RAG 학습 코스 HTML을 만든다. 의존성 없음.
//   node scripts/docs/build-rag-guide.mjs
// 입력: docs/rag-study/src/* (본문·스타일·UI), docs/rag-study/lab/* (실습 코드)
// 출력: docs/rag-study-guide.html (파일 하나, 오프라인에서 열림)
//
// 실습 코드는 브라우저 실습에서 그대로 실행되고, 원문은 내려받기용으로도 들어간다.
// 그래서 lab/*.mjs를 고치면 이 스크립트를 다시 돌려야 문서에 반영된다.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(root, "docs/rag-study/src");
const LAB = join(root, "docs/rag-study/lab");
const OUT = join(root, "docs/rag-study-guide.html");
const read = (p) => readFileSync(p, "utf8");

// 의존 순서대로. 다른 실습 파일을 import하는 파일은 뒤에 둔다.
const MODULES = ["metrics", "tokenize", "bm25", "rrf", "chunker", "ivf"];
const FILES = [...MODULES.map((m) => `${m}.mjs`), "lab.test.mjs", "README.md"];

/** lab/x.mjs를 `const LAB_x = (() => { ...; return { exports }; })();`로 바꾼다 */
function wrapModule(name) {
	let code = read(join(LAB, `${name}.mjs`));
	const exportsList = [];
	code = code.replace(
		/^import\s*\{([^}]+)\}\s*from\s*"\.\/(\w+)\.mjs";?$/gm,
		(_, names, mod) => {
			if (!MODULES.includes(mod))
				throw new Error(`${name}.mjs: 알 수 없는 import ${mod}`);
			return `const {${names}} = LAB_${mod};`;
		},
	);
	code = code.replace(
		/^export\s+(function|const|let|class)\s+(\w+)/gm,
		(_, kw, id) => {
			exportsList.push(id);
			return `${kw} ${id}`;
		},
	);
	if (/^\s*(import|export)\b/m.test(code))
		throw new Error(`${name}.mjs: 처리하지 못한 import/export`);
	return `const LAB_${name} = (() => {\n${code}\nreturn { ${exportsList.join(", ")} };\n})();`;
}

const formulas = JSON.parse(read(join(SRC, "formulas.json")));
const badge = {
	P: (r) => `<a class="b b-paper" href="#ref-${r}">논문 ${r}</a>`,
	D: (r) => `<a class="b b-doc" href="#ref-${r}">문서 ${r}</a>`,
	E: (s) =>
		`<span class="b b-exp" title="docs/search-quality-evaluation.md ${s}절">실측 ${s}</span>`,
	C: (s) => `<span class="b b-code" title="저장소 코드">코드 ${s}</span>`,
};

let content = read(join(SRC, "content.html"));
content = content
	.replace(/@@F:(\w+)@@/g, (_, k) => {
		if (!formulas[k]) throw new Error(`수식 없음: ${k}`);
		return formulas[k];
	})
	.replace(/\[\[I\]\]/g, '<span class="b b-me">해석</span>')
	.replace(/\[\[SRC:([\w.]+)\]\]/g, (_, f) => {
		if (!FILES.includes(f)) throw new Error(`실습 파일 없음: ${f}`);
		return `<button class="btn sm src-btn" data-src="${f}">📄 ${f} 코드 보기</button>`;
	})
	.replace(/\[\[([PDEC]):([^\]]+)\]\]/g, (_, t, v) => badge[t](v));
if (/\[\[|@@/.test(content))
	throw new Error(
		`치환되지 않은 표시: ${content.match(/(\[\[|@@).{0,30}/)[0]}`,
	);

// 참고문헌 링크가 모두 존재하는지 확인
const ids = new Set([...content.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const missing = [...content.matchAll(/href="#([^"]+)"/g)]
	.map((m) => m[1])
	.filter((h) => !ids.has(h));
if (missing.length)
	throw new Error(`없는 앵커: ${[...new Set(missing)].join(", ")}`);

const sources = FILES.map((f) => {
	const text = read(join(LAB, f)).replace(/<\/script/gi, "<\\/script");
	return `<script type="text/plain" data-file="${f}">${text}</script>`;
}).join("\n");

const html = read(join(SRC, "shell.html"))
	.replace("/*@@STYLE@@*/", () => read(join(SRC, "style.css")))
	.replace("<!--@@CONTENT@@-->", () => content)
	.replace("<!--@@SOURCES@@-->", () => sources)
	.replace("/*@@LAB@@*/", () => MODULES.map(wrapModule).join("\n\n"))
	.replace("/*@@APP@@*/", () => read(join(SRC, "app.js")));

writeFileSync(OUT, html);
console.log(
	`${OUT.replace(`${root}/`, "")} ${(html.length / 1024).toFixed(0)}KB, 모듈 ${(content.match(/class="module"/g) || []).length}개, 앵커 확인 완료`,
);
