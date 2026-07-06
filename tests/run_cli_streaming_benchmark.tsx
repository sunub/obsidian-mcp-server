import { performance } from "node:perf_hooks";
import { Box, Text } from "ink";
import * as React from "react";
import type { HistoryItem, PendingItem } from "../src/cli/types.js";
import { HistoryItemDisplay } from "../src/cli/ui/HistoryItemDisplay.js";

void React;

interface BenchmarkStats {
	name: string;
	meanMs: number;
	p50Ms: number;
	minMs: number;
	maxMs: number;
}

const WIDTH = 80;
const HISTORY_ITEMS = 20;
const STREAM_CHUNKS = 400;
const MEASURED_RUNS = 120;
const WARMUP_RUNS = 12;
const THINKING_LINES = 6;

function createParagraph(seed: number, length: number): string {
	const words = [
		"streaming",
		"history",
		"response",
		"render",
		"react",
		"terminal",
		"state",
		"chunk",
		"message",
		"latency",
		"layout",
		"pending",
		"static",
		"session",
	];

	let text = "";
	let index = seed;
	while (text.length < length) {
		text += `${words[index % words.length]} `;
		index++;
	}

	return text.slice(0, length).trim();
}

function createHistoryItems(): HistoryItem[] {
	return Array.from({ length: HISTORY_ITEMS }, (_, index) => ({
		id: index + 1,
		type: index % 2 === 0 ? "user" : "assistant",
		content: [
			createParagraph(index * 3, 180),
			createParagraph(index * 5 + 1, 180),
		].join("\n"),
		timestamp: index,
	}));
}

function createPendingSequence(): PendingItem[] {
	let content = "";
	const sequence: PendingItem[] = [];

	for (let index = 0; index < STREAM_CHUNKS; index++) {
		content += `${createParagraph(index, 36)} `;

		const includeThinking = index < 40;
		const thinkingContent = includeThinking
			? Array.from(
					{ length: 8 },
					(_, lineIndex) =>
						`step ${lineIndex + 1}: ${createParagraph(index + lineIndex, 28)}`,
				).join("\n")
			: undefined;

		sequence.push({
			type: "assistant",
			content: content.trim(),
			thinkingContent,
			isThinking: includeThinking,
			isComplete: index === STREAM_CHUNKS - 1,
		});
	}

	return sequence;
}

function renderThinkingBlock(content: string, isActive: boolean) {
	const lines = content.split("\n").filter((line) => line.trim().length > 0);
	const displayLines = isActive ? lines : lines.slice(0, THINKING_LINES);
	const truncated = !isActive && lines.length > THINKING_LINES;

	return (
		<Box
			flexDirection="column"
			borderStyle="single"
			borderColor="gray"
			paddingX={1}
			marginBottom={isActive ? 0 : 1}
		>
			<Text color="gray" dimColor bold>
				💭 {isActive ? "thinking..." : `thought (${lines.length} lines)`}
			</Text>
			{displayLines.map((line, index) => (
				<Text
					// biome-ignore lint/suspicious/noArrayIndexKey: benchmark-only deterministic lines
					key={index}
					color="gray"
					dimColor
					wrap="wrap"
				>
					{line}
				</Text>
			))}
			{truncated && (
				<Text color="gray" dimColor>
					... ({lines.length - THINKING_LINES} more lines)
				</Text>
			)}
		</Box>
	);
}

function renderPendingItem(pendingItem: PendingItem) {
	return (
		<Box flexDirection="column" width={WIDTH} paddingX={1} marginBottom={1}>
			{pendingItem.thinkingContent &&
				renderThinkingBlock(
					pendingItem.thinkingContent,
					pendingItem.isThinking === true,
				)}
			{pendingItem.content.length > 0 && (
				<>
					<Text color="cyan" bold>
						◀ Assistant
					</Text>
					<Text wrap="wrap">{pendingItem.content}</Text>
				</>
			)}
		</Box>
	);
}

function renderHistoryPass(history: HistoryItem[]): void {
	for (const item of history) {
		HistoryItemDisplay({ item, width: WIDTH });
	}
}

function renderPendingPass(sequence: PendingItem[]): void {
	for (const pendingItem of sequence) {
		renderPendingItem(pendingItem);
	}
}

function measure(name: string, fn: () => void): BenchmarkStats {
	const samples: number[] = [];

	for (let run = 0; run < WARMUP_RUNS + MEASURED_RUNS; run++) {
		const start = performance.now();
		fn();
		const end = performance.now();

		if (run >= WARMUP_RUNS) {
			samples.push(end - start);
		}
	}

	samples.sort((a, b) => a - b);
	const total = samples.reduce((sum, sample) => sum + sample, 0);

	return {
		name,
		meanMs: total / samples.length,
		p50Ms: samples[Math.floor(samples.length / 2)] ?? 0,
		minMs: samples[0] ?? 0,
		maxMs: samples.at(-1) ?? 0,
	};
}

function formatRow(stats: BenchmarkStats): string {
	return [
		stats.name.padEnd(32, " "),
		stats.meanMs.toFixed(3).padStart(9, " "),
		stats.p50Ms.toFixed(3).padStart(9, " "),
		stats.minMs.toFixed(3).padStart(9, " "),
		stats.maxMs.toFixed(3).padStart(9, " "),
	].join(" | ");
}

function percentReduction(before: number, after: number): number {
	if (before === 0) {
		return 0;
	}

	return ((before - after) / before) * 100;
}

function speedup(before: number, after: number): number {
	if (after === 0) {
		return 0;
	}

	return before / after;
}

function main(): void {
	const history = createHistoryItems();
	const pendingSequence = createPendingSequence();

	const historyPass = measure("history render pass (20 items)", () => {
		renderHistoryPass(history);
	});

	const pendingOnlyStream = measure("split stream updates", () => {
		renderPendingPass(pendingSequence);
	});

	const naiveStream = measure("naive full rerender stream", () => {
		for (const pendingItem of pendingSequence) {
			renderHistoryPass(history);
			renderPendingItem(pendingItem);
		}
	});

	const splitStream = measure("history/pending split stream", () => {
		renderHistoryPass(history);
		renderPendingPass(pendingSequence);
	});

	const avoidedHistoryPasses = HISTORY_ITEMS * STREAM_CHUNKS;
	const naiveHistoryWorkMs = historyPass.meanMs * STREAM_CHUNKS;
	const sessionReduction = percentReduction(
		naiveStream.meanMs,
		splitStream.meanMs,
	);
	const sessionSpeedup = speedup(naiveStream.meanMs, splitStream.meanMs);

	console.log("\n--- CLI Streaming Render Benchmark ---\n");
	console.log(
		`Scenario: ${HISTORY_ITEMS} retained history items (current prune cap), ${STREAM_CHUNKS} streaming chunks, width ${WIDTH}`,
	);
	console.log(
		"Benchmark scope: component render work for streaming updates, comparing a naive full-history rerender path with the current split history/pending model.\n",
	);
	console.log(
		"Case                             |   mean ms |    p50 ms |    min ms |    max ms",
	);
	console.log(
		"---------------------------------+-----------+-----------+-----------+-----------",
	);
	console.log(formatRow(historyPass));
	console.log(formatRow(pendingOnlyStream));
	console.log(formatRow(naiveStream));
	console.log(formatRow(splitStream));

	console.log("\n[Resume-safe summary]");
	console.log(
		`- One history render pass for ${HISTORY_ITEMS} items took ${historyPass.meanMs.toFixed(3)}ms on average.`,
	);
	console.log(
		`- In a ${STREAM_CHUNKS}-chunk response, a naive rerender model would recreate ${avoidedHistoryPasses.toLocaleString()} historical message components.`,
	);
	console.log(
		`- That repeated history work accounts for about ${naiveHistoryWorkMs.toFixed(1)}ms of cumulative render time per response in this benchmark.`,
	);
	console.log(
		`- End-to-end streaming session cost dropped from ${naiveStream.meanMs.toFixed(3)}ms to ${splitStream.meanMs.toFixed(3)}ms (${sessionReduction.toFixed(1)}% reduction, ${sessionSpeedup.toFixed(1)}x faster) when history rendering was fixed and only the pending response kept updating.`,
	);
}

main();
