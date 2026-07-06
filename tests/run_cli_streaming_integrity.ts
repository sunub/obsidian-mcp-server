import { performance } from "node:perf_hooks";
import { findLastSafeSplitPoint } from "../src/cli/hooks/useLlmStream/markdownUtils.js";
import type { HistoryItem, PendingItem } from "../src/cli/types.js";

const STREAM_CHUNKS = 400;
const INTERVALS_MS = [10, 20, 30] as const;
const RUNS_PER_INTERVAL = 5;

interface StreamSnapshot {
	history: HistoryItem[];
	pendingItem: PendingItem | null;
	buffer: string;
	isFirstChunk: boolean;
	timestamp: number;
}

interface IntegrityRunResult {
	intervalMs: number;
	run: number;
	chunks: number;
	expectedChars: number;
	actualChars: number;
	missingChars: number;
	extraChars: number;
	mismatchIndex: number;
	lossRate: number;
	durationMs: number;
	flushes: number;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createChunk(index: number): string {
	const marker = `[chunk-${String(index).padStart(3, "0")}]`;
	const body = [
		"streaming",
		"response",
		"integrity",
		"mutable-ref-buffer",
		"react-state-sync",
		"terminal-output",
	][index % 6];

	return `${marker} ${body} line ${index}\n`;
}

function createChunks(): string[] {
	return Array.from({ length: STREAM_CHUNKS }, (_, index) =>
		createChunk(index),
	);
}

function appendChunk(snapshot: StreamSnapshot, chunk: string): void {
	snapshot.buffer += chunk;

	const splitPoint = findLastSafeSplitPoint(snapshot.buffer);

	if (splitPoint === snapshot.buffer.length) {
		snapshot.pendingItem = {
			type: "assistant",
			content: snapshot.buffer,
			isComplete: false,
		};
		return;
	}

	const before = snapshot.buffer.substring(0, splitPoint);
	const after = snapshot.buffer.substring(splitPoint);

	snapshot.history.push({
		id: snapshot.history.length + 1,
		type: snapshot.isFirstChunk ? "assistant" : "assistant_chunk",
		content: before,
		timestamp: snapshot.timestamp,
	});

	snapshot.isFirstChunk = false;
	snapshot.buffer = after;
	snapshot.pendingItem = {
		type: "assistant",
		content: after,
		isComplete: false,
	};
}

function flushPending(snapshot: StreamSnapshot): void {
	if (!snapshot.pendingItem) return;

	snapshot.history.push({
		id: snapshot.history.length + 1,
		type: snapshot.isFirstChunk ? "assistant" : "assistant_chunk",
		content: snapshot.pendingItem.content,
		timestamp: snapshot.timestamp,
	});

	snapshot.isFirstChunk = false;
	snapshot.pendingItem = null;
	snapshot.buffer = "";
}

function collectAssistantOutput(history: HistoryItem[]): string {
	return history
		.filter(
			(item) => item.type === "assistant" || item.type === "assistant_chunk",
		)
		.map((item) => item.content)
		.join("");
}

function firstMismatchIndex(expected: string, actual: string): number {
	const max = Math.min(expected.length, actual.length);
	for (let index = 0; index < max; index++) {
		if (expected[index] !== actual[index]) return index;
	}

	return expected.length === actual.length ? -1 : max;
}

async function runIntegrityCheck(
	intervalMs: number,
	run: number,
): Promise<IntegrityRunResult> {
	const chunks = createChunks();
	const expected = chunks.join("");
	const snapshot: StreamSnapshot = {
		history: [],
		pendingItem: null,
		buffer: "",
		isFirstChunk: true,
		timestamp: Date.now(),
	};

	const start = performance.now();

	for (const chunk of chunks) {
		await sleep(intervalMs);
		appendChunk(snapshot, chunk);
	}

	flushPending(snapshot);

	const durationMs = performance.now() - start;
	const actual = collectAssistantOutput(snapshot.history);
	const mismatchIndex = firstMismatchIndex(expected, actual);
	const missingChars = Math.max(expected.length - actual.length, 0);
	const extraChars = Math.max(actual.length - expected.length, 0);
	const lossRate =
		expected.length === 0 ? 0 : (missingChars / expected.length) * 100;

	return {
		intervalMs,
		run,
		chunks: chunks.length,
		expectedChars: expected.length,
		actualChars: actual.length,
		missingChars,
		extraChars,
		mismatchIndex,
		lossRate,
		durationMs,
		flushes: snapshot.history.length,
	};
}

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value: number): string {
	return `${value.toFixed(4)}%`;
}

async function main(): Promise<void> {
	const results: IntegrityRunResult[] = [];

	for (const intervalMs of INTERVALS_MS) {
		for (let run = 1; run <= RUNS_PER_INTERVAL; run++) {
			results.push(await runIntegrityCheck(intervalMs, run));
		}
	}

	const totalRuns = results.length;
	const failedRuns = results.filter((result) => result.mismatchIndex !== -1);
	const totalExpectedChars = results.reduce(
		(sum, result) => sum + result.expectedChars,
		0,
	);
	const totalMissingChars = results.reduce(
		(sum, result) => sum + result.missingChars,
		0,
	);
	const totalLossRate =
		totalExpectedChars === 0
			? 0
			: (totalMissingChars / totalExpectedChars) * 100;

	console.log("\n--- CLI Streaming Integrity Check ---\n");
	console.log(
		`Scenario: ${STREAM_CHUNKS} chunks, intervals ${INTERVALS_MS.join("/")}ms, ${RUNS_PER_INTERVAL} runs per interval`,
	);
	console.log(
		"Validation: concatenate baseline chunks and compare against final assistant output after ref-buffer accumulation and pending flush.\n",
	);
	console.log(
		"Interval | Runs | Chunks/run | Mean duration | Mean flushes | Missing chars | Loss rate | Mismatches",
	);
	console.log(
		"---------+------+------------+---------------+--------------+---------------+-----------+-----------",
	);

	for (const intervalMs of INTERVALS_MS) {
		const byInterval = results.filter(
			(result) => result.intervalMs === intervalMs,
		);
		const intervalMissing = byInterval.reduce(
			(sum, result) => sum + result.missingChars,
			0,
		);
		const intervalExpected = byInterval.reduce(
			(sum, result) => sum + result.expectedChars,
			0,
		);
		const intervalLoss =
			intervalExpected === 0 ? 0 : (intervalMissing / intervalExpected) * 100;
		const intervalMismatches = byInterval.filter(
			(result) => result.mismatchIndex !== -1,
		).length;

		console.log(
			[
				`${intervalMs}ms`.padEnd(8, " "),
				String(byInterval.length).padStart(4, " "),
				String(STREAM_CHUNKS).padStart(10, " "),
				`${mean(byInterval.map((result) => result.durationMs)).toFixed(1)}ms`.padStart(
					13,
					" ",
				),
				mean(byInterval.map((result) => result.flushes))
					.toFixed(1)
					.padStart(12, " "),
				String(intervalMissing).padStart(13, " "),
				formatPercent(intervalLoss).padStart(9, " "),
				String(intervalMismatches).padStart(9, " "),
			].join(" | "),
		);
	}

	console.log("\n[Resume-safe summary]");
	console.log(`- Total runs: ${totalRuns}`);
	console.log(
		`- Compared output: ${totalExpectedChars.toLocaleString()} expected chars vs ${(totalExpectedChars - totalMissingChars).toLocaleString()} final-output chars`,
	);
	console.log(`- Missing chars: ${totalMissingChars}`);
	console.log(`- Data loss rate: ${formatPercent(totalLossRate)}`);
	console.log(`- Mismatched runs: ${failedRuns.length}`);

	if (failedRuns.length > 0) {
		const firstFailure = failedRuns[0];
		console.error(
			`First mismatch: interval=${firstFailure.intervalMs}ms run=${firstFailure.run} index=${firstFailure.mismatchIndex}`,
		);
		process.exitCode = 1;
	}
}

await main();
