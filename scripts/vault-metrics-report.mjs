#!/usr/bin/env node
/**
 * vault 도구의 응답 계측 로그(JSONL)를 집계해 리포트를 출력합니다.
 *
 * 로그는 src/tools/vault/metrics.ts의 recordVaultResponseMetric()이
 * VAULT_METRICS_LOG_PATH 환경변수에 지정된 파일로 한 줄씩 append 합니다.
 *
 * 사용법:
 *   VAULT_METRICS_LOG_PATH=./metrics/vault.jsonl npm run metrics:report
 *   npm run metrics:report -- ./metrics/vault.jsonl
 *   npm run metrics:report -- ./metrics/vault.jsonl --json
 */

import { readFile } from "node:fs/promises";
import { argv, env, exit, stdout } from "node:process";

const args = argv.slice(2);
const asJson = args.includes("--json");
const pathArg = args.find((arg) => !arg.startsWith("--"));
const logPath = pathArg ?? env.VAULT_METRICS_LOG_PATH;

if (!logPath) {
	console.error(
		"계측 로그 경로가 없습니다.\n" +
			"  VAULT_METRICS_LOG_PATH=<경로> npm run metrics:report\n" +
			"  또는: npm run metrics:report -- <경로>",
	);
	exit(1);
}

let raw;
try {
	raw = await readFile(logPath, "utf8");
} catch (error) {
	console.error(`계측 로그를 읽을 수 없습니다: ${logPath}\n  ${error.message}`);
	exit(1);
}

const metrics = [];
let malformed = 0;

for (const line of raw.split("\n")) {
	const trimmed = line.trim();
	if (!trimmed) continue;
	try {
		const parsed = JSON.parse(trimmed);
		if (
			parsed &&
			typeof parsed === "object" &&
			typeof parsed.action === "string"
		) {
			metrics.push(parsed);
		} else {
			malformed++;
		}
	} catch {
		malformed++;
	}
}

if (metrics.length === 0) {
	console.error(`집계할 레코드가 없습니다: ${logPath} (손상 ${malformed}줄)`);
	exit(1);
}

const mean = (values) =>
	values.length === 0
		? 0
		: values.reduce((sum, value) => sum + value, 0) / values.length;

const percentile = (values, p) => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
	);
	return sorted[index];
};

function summarize(records) {
	const tokens = records.map((record) => record.estimated_tokens ?? 0);
	const outputChars = records.map((record) => record.output_chars ?? 0);
	const sourceChars = records.map((record) => record.source_chars ?? 0);

	const totalSource = sourceChars.reduce((sum, value) => sum + value, 0);
	const totalOutput = outputChars.reduce((sum, value) => sum + value, 0);

	const cacheKnown = records.filter(
		(record) => typeof record.cache_hit === "boolean",
	);

	return {
		calls: records.length,
		avg_tokens: Math.round(mean(tokens)),
		p95_tokens: Math.round(percentile(tokens, 95)),
		max_tokens: Math.max(...tokens),
		avg_docs: Number(mean(records.map((r) => r.doc_count ?? 0)).toFixed(1)),
		// 압축률: 원본 문자 수 대비 실제 전달한 문자 수가 몇 % 줄었는지
		compression_pct:
			totalSource > 0
				? Number((((totalSource - totalOutput) / totalSource) * 100).toFixed(1))
				: null,
		truncated_pct: Number(
			(
				(records.filter((r) => r.truncated).length / records.length) *
				100
			).toFixed(1),
		),
		cache_hit_pct:
			cacheKnown.length > 0
				? Number(
						(
							(cacheKnown.filter((r) => r.cache_hit).length /
								cacheKnown.length) *
							100
						).toFixed(1),
					)
				: null,
	};
}

const byAction = new Map();
for (const metric of metrics) {
	const bucket = byAction.get(metric.action) ?? [];
	bucket.push(metric);
	byAction.set(metric.action, bucket);
}

const byMode = new Map();
for (const metric of metrics) {
	const mode = metric.mode ?? "unknown";
	const bucket = byMode.get(mode) ?? [];
	bucket.push(metric);
	byMode.set(mode, bucket);
}

const report = {
	source: logPath,
	records: metrics.length,
	malformed_lines: malformed,
	overall: summarize(metrics),
	by_action: Object.fromEntries(
		[...byAction.entries()]
			.sort((a, b) => b[1].length - a[1].length)
			.map(([action, records]) => [action, summarize(records)]),
	),
	by_compression_mode: Object.fromEntries(
		[...byMode.entries()]
			.sort((a, b) => b[1].length - a[1].length)
			.map(([mode, records]) => [mode, summarize(records)]),
	),
};

if (asJson) {
	stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	exit(0);
}

const fmt = (value) => (value === null ? "-" : String(value));

const table = (title, entries) => {
	console.log(`\n${title}`);
	console.log(
		`  ${"key".padEnd(24)}${"calls".padStart(7)}${"avg tok".padStart(9)}${"p95 tok".padStart(9)}${"compress".padStart(10)}${"trunc".padStart(8)}${"cache".padStart(8)}`,
	);
	for (const [key, stats] of Object.entries(entries)) {
		console.log(
			`  ${key.padEnd(24)}${String(stats.calls).padStart(7)}${String(stats.avg_tokens).padStart(9)}${String(stats.p95_tokens).padStart(9)}${`${fmt(stats.compression_pct)}%`.padStart(10)}${`${stats.truncated_pct}%`.padStart(8)}${`${fmt(stats.cache_hit_pct)}%`.padStart(8)}`,
		);
	}
};

console.log("=== Vault 응답 계측 리포트 ===");
console.log(`  로그: ${logPath}`);
console.log(
	`  레코드: ${report.records}건${malformed > 0 ? ` (손상 ${malformed}줄 무시)` : ""}`,
);
console.log(
	`  전체: 평균 ${report.overall.avg_tokens} tok / p95 ${report.overall.p95_tokens} tok / 압축 ${fmt(report.overall.compression_pct)}% / 잘림 ${report.overall.truncated_pct}%`,
);

table("[action 별]", report.by_action);
table("[compression mode 별]", report.by_compression_mode);
console.log("");
