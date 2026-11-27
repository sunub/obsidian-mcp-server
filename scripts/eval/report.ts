import { readFile, writeFile } from "node:fs/promises";

const [searchFile, ...indexingFiles] = process.argv.slice(2);
if (!searchFile) {
	console.error("사용법: report.ts <search.json> [indexing.json ...]");
	process.exit(1);
}

type Summary = {
	n: number;
	recall5: number;
	recall10: number;
	mrr10: number;
	hit1: number;
	p50: number;
	p95: number;
};
type CI = { meanDiff: number; ciLow: number; ciHigh: number };

const s = JSON.parse(await readFile(searchFile, "utf-8"));
const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "-");
const f0 = (v: number) => (Number.isFinite(v) ? v.toFixed(0) : "-");
const pct = (v: number | null) =>
	v === null ? "-" : `${(v * 100).toFixed(0)}%`;
const ci = (c: CI) =>
	`${c.meanDiff >= 0 ? "+" : ""}${c.meanDiff.toFixed(3)} [${c.ciLow.toFixed(3)}, ${c.ciHigh.toFixed(3)}]${c.ciLow > 0 || c.ciHigh < 0 ? " *" : ""}`;

const lines: string[] = [];
const env = s.environment;
lines.push(`# 검색 품질 평가 결과 (${env.date.slice(0, 10)})`, "");
lines.push(
	`- 환경: ${env.platform}, ${env.cpu}, ${env.cores}코어, ${env.memoryGB}GB, Node ${env.node}`,
	`- Vault: 문서 ${env.documents}개, 청크 ${env.chunks}개, 벡터 인덱스 ${env.vectorIndexes.join(", ") || "없음"}`,
	`- 모델: 임베딩 ${env.embedder}${env.stripPrefix ? " (실험: search_query/search_document 접두사 제거)" : ""}`,
	`- 평가셋: 질의 ${s.queries.total}개 (${Object.entries(s.queries.byType)
		.map(([k, v]) => `${k} ${v}`)
		.join(
			", ",
		)}), 결과 수 ${env.limit}, 지연은 warm 상태에서 질의당 ${env.reps}회 측정`,
	"",
	"## 구성별 품질과 지연",
	"",
	"| 구성 | 설명 | Recall@5 | Recall@10 | MRR@10 | Hit@1 | p50 ms | p95 ms |",
	"|---|---|---:|---:|---:|---:|---:|---:|",
);
for (const c of s.configs) {
	const a: Summary = s.summary[c.name].all;
	lines.push(
		`| ${c.name} | ${c.description} | ${f3(a.recall5)} | ${f3(a.recall10)} | ${f3(a.mrr10)} | ${f3(a.hit1)} | ${f0(a.p50)} | ${f0(a.p95)} |`,
	);
}

const types = Object.keys(s.queries.byType);
lines.push("", "## 질의 유형별 Recall@5 / MRR@10", "");
lines.push(
	`| 구성 | ${types.join(" | ")} |`,
	`|---|${types.map(() => "---:").join("|")}|`,
);
for (const c of s.configs) {
	const by = s.summary[c.name].byType;
	lines.push(
		`| ${c.name} | ${types.map((t) => `${f3(by[t].recall5)} / ${f3(by[t].mrr10)}`).join(" | ")} |`,
	);
}

lines.push(
	"",
	"## 짝지은 비교 (B − A, 부트스트랩 95% 신뢰구간, * = 0을 포함하지 않음)",
	"",
	"| 비교 | A → B | ΔRecall@5 | ΔMRR@10 |",
	"|---|---|---|---|",
);
for (const p of s.paired) {
	lines.push(
		`| ${p.label} | ${p.a} → ${p.b} | ${ci(p.recall5)} | ${ci(p.mrr10)} |`,
	);
}

if (s.parity) {
	lines.push(
		"",
		"## 재현 검증과 실제 경로",
		"",
		`- 재현(E_production)과 실제 \`VaultManager.hybridSearch\` 결과 일치: 전체 목록 ${pct(s.parity.exactListMatch)}, 상위 5개 ${pct(s.parity.top5Match)}${s.parity.mismatched.length ? ` (불일치: ${s.parity.mismatched.join(", ")})` : ""}`,
		`- 실제 \`hybridSearch\` warm 지연: p50 ${f0(s.parity.warmLatencyMs.p50)}ms, p95 ${f0(s.parity.warmLatencyMs.p95)}ms`,
		`- 모델이 내려간 뒤 첫 검색(cold, ${s.cold.trials.length}회): p50 ${f0(s.cold.p50Ms)}ms, 최대 ${f0(s.cold.maxMs)}ms, 벡터 검색 없이 키워드로만 반환된 비율 ${pct(s.cold.keywordOnlyFallbackRate)}`,
		`- E_production 상위 5개 중 정답으로 판정된 문서 비율: ${pct(s.judgedAt5E)} (나머지는 사람이 검토하지 않은 문서이며 \`*-unjudged.jsonl\`에 있음)`,
	);
}
for (const file of indexingFiles) {
	const ix = JSON.parse(await readFile(file, "utf-8"));
	lines.push("", `## 인덱싱 (${file.split("/").pop()})`, "");
	if (ix.keyword) {
		const k = ix.keyword;
		lines.push(
			`- 키워드 인덱스(실제 Vault): 파일 ${k.files}개 / ${k.totalMB.toFixed(1)}MB, 실패 ${k.failed}건, build 중앙값 ${f0(k.buildMs.median)}ms (${k.buildMs.runs.length}회) → **초당 ${f0(k.docsPerSec)}건**, ${k.mbPerSec.toFixed(1)}MB/s`,
		);
	}
	if (ix.synthetic) {
		const k = ix.synthetic;
		lines.push(
			`- 키워드 인덱스(실제 문서 내용으로 만든 파일 ${k.files}개 / ${k.totalMB.toFixed(0)}MB): 실패 ${k.failed}건, 중앙값 ${(k.buildMs.median / 1000).toFixed(1)}s → **초당 ${f0(k.docsPerSec)}건**`,
		);
	}
	if (ix.rag) {
		const r = ix.rag;
		lines.push(
			`- 임베딩 인덱스(빈 캐시에서 생성): 문서 ${r.documents}개, 1회차 ${r.firstPass.seconds.toFixed(0)}s, 청크 ${r.firstPass.chunks}개 (초당 ${r.firstPass.chunksPerSec.toFixed(1)}청크), 1회차 커버리지 ${pct(r.firstPass.coverage)} → 최종 ${pct(r.final.coverage)} (${r.passes.length}회 동기화)`,
		);
	}
}

const out = searchFile.replace(/\.json$/, ".md");
await writeFile(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
console.error(`\n저장: ${out}`);
