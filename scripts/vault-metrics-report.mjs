#!/usr/bin/env node
import { readFile } from "node:fs/promises";

function toNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function p95(values) {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
	return sorted[index];
}

function round(value) {
	return Number(value.toFixed(2));
}

function summarize(group) {
	const tokenValues = group
		.map((item) => toNumber(item.estimated_tokens))
		.filter((v) => v !== null);
	const docCounts = group
		.map((item) => toNumber(item.doc_count))
		.filter((v) => v !== null);
	const truncatedCount = group.filter((item) => item.truncated === true).length;

	const totalTokens = tokenValues.reduce((sum, value) => sum + value, 0);
	const avgTokens = tokenValues.length ? totalTokens / tokenValues.length : 0;
	const avgDocs = docCounts.length
		? docCounts.reduce((sum, value) => sum + value, 0) / docCounts.length
		: 0;
	const truncatedRate = group.length
		? (truncatedCount / group.length) * 100
		: 0;

	return {
		count: group.length,
		totalTokens: round(totalTokens),
		avgTokens: round(avgTokens),
		p95Tokens: round(p95(tokenValues)),
		avgDocs: round(avgDocs),
		truncatedRate: round(truncatedRate),
	};
}

function printTable(rows) {
	const header = [
		"action",
		"count",
		"total_tokens",
		"avg_tokens",
		"p95_tokens",
		"avg_doc_count",
		"truncated_rate(%)",
	];
	const widths = header.map((h) => h.length);

	for (const row of rows) {
		row.forEach((value, index) => {
			widths[index] = Math.max(widths[index], String(value).length);
		});
	}

	const formatRow = (row) =>
		row
			.map((value, index) => String(value).padEnd(widths[index], " "))
			.join(" | ");

	console.log(formatRow(header));
	console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
	for (const row of rows) {
		console.log(formatRow(row));
	}
}

async function main() {
	const targetPath =
		process.argv[2] ||
		process.env.VAULT_METRICS_LOG_PATH ||
		"./.tmp/vault-metrics.jsonl";

	let content;
	try {
		content = await readFile(targetPath, "utf8");
	} catch (error) {
		console.error(
			`Cannot read metrics log file: ${targetPath} (${error instanceof Error ? error.message : String(error)})`,
		);
		process.exit(1);
	}

	const rows = content
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		})
		.filter((item) => item && typeof item === "object");

	if (rows.length === 0) {
		console.log("No metric rows found.");
		return;
	}

	const byAction = new Map();
	for (const row of rows) {
		const action =
			typeof row.action === "string" && row.action.length > 0
				? row.action
				: "unknown";
		if (!byAction.has(action)) {
			byAction.set(action, []);
		}
		byAction.get(action).push(row);
	}

	const summaryRows = [];
	for (const [action, group] of [...byAction.entries()].sort((a, b) =>
		a[0].localeCompare(b[0]),
	)) {
		const summary = summarize(group);
		summaryRows.push([
			action,
			summary.count,
			summary.totalTokens,
			summary.avgTokens,
			summary.p95Tokens,
			summary.avgDocs,
			summary.truncatedRate,
		]);
	}

	const overall = summarize(rows);
	summaryRows.push([
		"TOTAL",
		overall.count,
		overall.totalTokens,
		overall.avgTokens,
		overall.p95Tokens,
		overall.avgDocs,
		overall.truncatedRate,
	]);

	console.log(`Metrics file: ${targetPath}`);
	console.log(`Rows: ${rows.length}`);
	printTable(summaryRows);
}

await main();
