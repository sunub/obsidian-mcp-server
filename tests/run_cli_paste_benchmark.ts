import { performance } from "node:perf_hooks";
import {
	buildExpandedPasteInfo,
	calculateLayout,
	calculateTransformationsForLine,
} from "../src/cli/key/textBuffer/textBuffer.js";

interface BenchmarkStats {
	name: string;
	meanMs: number;
	minMs: number;
	maxMs: number;
	p50Ms: number;
}

interface ScenarioResult extends BenchmarkStats {
	logicalLines: number;
	visualLines: number;
	visibleChars: number;
}

const VIEWPORT_WIDTH = 80;
const ITERATIONS = 150;
const WARMUP_ITERATIONS = 15;
const LINE_COUNT = 400;
const LINE_WIDTH = 120;

function createLine(lineIndex: number, variant: number): string {
	const prefix = `Line ${lineIndex.toString().padStart(4, "0")} v${variant.toString().padStart(3, "0")} :: `;
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	let body = "";
	while (body.length < Math.max(0, LINE_WIDTH - prefix.length)) {
		body += alphabet[(lineIndex + body.length + variant) % alphabet.length];
	}
	return `${prefix}${body.slice(0, Math.max(0, LINE_WIDTH - prefix.length))}`;
}

function createPastePayload(variant: number): string {
	return Array.from({ length: LINE_COUNT }, (_, index) =>
		createLine(index, variant),
	).join("\n");
}

function summarizeLayout(visualLines: string[]): {
	visualLines: number;
	visibleChars: number;
} {
	return {
		visualLines: visualLines.length,
		visibleChars: visualLines.reduce((sum, line) => sum + line.length, 0),
	};
}

function computeStats(name: string, samples: number[]): BenchmarkStats {
	const sorted = [...samples].sort((a, b) => a - b);
	const sum = sorted.reduce((acc, sample) => acc + sample, 0);
	const p50Index = Math.floor(sorted.length / 2);

	return {
		name,
		meanMs: sum / sorted.length,
		minMs: sorted[0] ?? 0,
		maxMs: sorted.at(-1) ?? 0,
		p50Ms: sorted[p50Index] ?? 0,
	};
}

function runScenario(
	name: string,
	createScenario: (variant: number) => {
		logicalLines: string[];
		pastedContent: Record<string, string>;
		expandedPaste: ReturnType<typeof buildExpandedPasteInfo>;
	},
): ScenarioResult {
	const coldSamples: number[] = [];
	let summary = { visualLines: 0, visibleChars: 0 };
	let logicalLineCount = 0;

	for (
		let iteration = 0;
		iteration < WARMUP_ITERATIONS + ITERATIONS;
		iteration++
	) {
		const variant = iteration;
		const { logicalLines, pastedContent, expandedPaste } =
			createScenario(variant);
		const start = performance.now();
		const layout = calculateLayout(
			logicalLines,
			VIEWPORT_WIDTH,
			[0, 0],
			pastedContent,
			expandedPaste,
		);
		const end = performance.now();

		if (iteration >= WARMUP_ITERATIONS) {
			coldSamples.push(end - start);
		}

		if (iteration === WARMUP_ITERATIONS) {
			logicalLineCount = logicalLines.length;
			summary = summarizeLayout(layout.visualLines);
		}
	}

	const stats = computeStats(name, coldSamples);
	return {
		...stats,
		logicalLines: logicalLineCount,
		visualLines: summary.visualLines,
		visibleChars: summary.visibleChars,
	};
}

function runHotScenario(
	name: string,
	scenario: {
		logicalLines: string[];
		pastedContent: Record<string, string>;
		expandedPaste: ReturnType<typeof buildExpandedPasteInfo>;
	},
): BenchmarkStats {
	const samples: number[] = [];

	for (
		let iteration = 0;
		iteration < WARMUP_ITERATIONS + ITERATIONS;
		iteration++
	) {
		const start = performance.now();
		calculateLayout(
			scenario.logicalLines,
			VIEWPORT_WIDTH,
			[0, 0],
			scenario.pastedContent,
			scenario.expandedPaste,
		);
		const end = performance.now();

		if (iteration >= WARMUP_ITERATIONS) {
			samples.push(end - start);
		}
	}

	return computeStats(name, samples);
}

function makeCollapsedPlaceholderScenario(variant: number) {
	const payload = createPastePayload(variant);
	const placeholder = `[Pasted Text: ${LINE_COUNT} lines #${variant}]`;
	return {
		logicalLines: [placeholder],
		pastedContent: { [placeholder]: payload },
		expandedPaste: null,
	};
}

function makeExpandedPlaceholderScenario(variant: number) {
	const payload = createPastePayload(variant);
	const placeholder = `[Pasted Text: ${LINE_COUNT} lines #${variant}]`;
	const [transformation] = calculateTransformationsForLine(placeholder);
	const expandedPaste = buildExpandedPasteInfo(placeholder, 0, transformation, {
		[placeholder]: payload,
	});

	return {
		logicalLines: [placeholder],
		pastedContent: { [placeholder]: payload },
		expandedPaste,
	};
}

function makeInlineScenario(variant: number) {
	const payload = createPastePayload(variant);
	return {
		logicalLines: payload.split("\n"),
		pastedContent: {},
		expandedPaste: null,
	};
}

function formatScenarioRow(result: ScenarioResult): string {
	return [
		result.name.padEnd(26, " "),
		result.meanMs.toFixed(3).padStart(9, " "),
		result.p50Ms.toFixed(3).padStart(9, " "),
		String(result.logicalLines).padStart(7, " "),
		String(result.visualLines).padStart(7, " "),
		String(result.visibleChars).padStart(9, " "),
	].join(" | ");
}

function formatHotRow(result: BenchmarkStats): string {
	return [
		result.name.padEnd(26, " "),
		result.meanMs.toFixed(3).padStart(9, " "),
		result.p50Ms.toFixed(3).padStart(9, " "),
		result.minMs.toFixed(3).padStart(9, " "),
		result.maxMs.toFixed(3).padStart(9, " "),
	].join(" | ");
}

function percentageReduction(before: number, after: number): number {
	if (before === 0) return 0;
	return ((before - after) / before) * 100;
}

function speedup(before: number, after: number): number {
	if (after === 0) return 0;
	return before / after;
}

function printSummary(
	inlineResult: ScenarioResult,
	collapsedResult: ScenarioResult,
	expandedResult: ScenarioResult,
	inlineHot: BenchmarkStats,
	collapsedHot: BenchmarkStats,
): void {
	const visualReduction = percentageReduction(
		inlineResult.visualLines,
		collapsedResult.visualLines,
	);
	const visibleCharReduction = percentageReduction(
		inlineResult.visibleChars,
		collapsedResult.visibleChars,
	);
	const coldReduction = percentageReduction(
		inlineResult.meanMs,
		collapsedResult.meanMs,
	);
	const hotReduction = percentageReduction(
		inlineHot.meanMs,
		collapsedHot.meanMs,
	);
	const coldSpeedup = speedup(inlineResult.meanMs, collapsedResult.meanMs);
	const hotSpeedup = speedup(inlineHot.meanMs, collapsedHot.meanMs);

	console.log("\n--- CLI Paste Layout Benchmark ---\n");
	console.log(
		`Payload: ${LINE_COUNT} lines x ~${LINE_WIDTH} chars, viewport width ${VIEWPORT_WIDTH}, ${ITERATIONS} measured iterations`,
	);

	console.log("\n[Cold render / new payload each run]");
	console.log(
		"Scenario                   |   mean ms |    p50 ms |  logical |  visual | visible ch",
	);
	console.log(
		"---------------------------+-----------+-----------+----------+---------+-----------",
	);
	console.log(formatScenarioRow(inlineResult));
	console.log(formatScenarioRow(collapsedResult));
	console.log(formatScenarioRow(expandedResult));

	console.log("\n[Hot render / same payload reused]");
	console.log(
		"Scenario                   |   mean ms |    p50 ms |    min ms |    max ms",
	);
	console.log(
		"---------------------------+-----------+-----------+-----------+-----------",
	);
	console.log(formatHotRow(inlineHot));
	console.log(formatHotRow(collapsedHot));

	console.log("\n[Resume-safe summary]");
	console.log(
		`- Collapsed placeholder reduced visible render lines from ${inlineResult.visualLines} to ${collapsedResult.visualLines} (${visualReduction.toFixed(1)}% reduction).`,
	);
	console.log(
		`- Collapsed placeholder reduced visible characters from ${inlineResult.visibleChars} to ${collapsedResult.visibleChars} (${visibleCharReduction.toFixed(1)}% reduction).`,
	);
	console.log(
		`- Cold layout time dropped from ${inlineResult.meanMs.toFixed(3)}ms to ${collapsedResult.meanMs.toFixed(3)}ms (${coldReduction.toFixed(1)}%, ${coldSpeedup.toFixed(1)}x faster).`,
	);
	console.log(
		`- Hot layout time dropped from ${inlineHot.meanMs.toFixed(3)}ms to ${collapsedHot.meanMs.toFixed(3)}ms (${hotReduction.toFixed(1)}%, ${hotSpeedup.toFixed(1)}x faster).`,
	);
	console.log(
		`- Expanded placeholder restored the full payload on demand with ${expandedResult.visualLines} visual lines and ${expandedResult.meanMs.toFixed(3)}ms mean cold layout time.`,
	);
}

function main(): void {
	const inlineResult = runScenario("inline full text", makeInlineScenario);
	const collapsedResult = runScenario(
		"collapsed placeholder",
		makeCollapsedPlaceholderScenario,
	);
	const expandedResult = runScenario(
		"expanded placeholder",
		makeExpandedPlaceholderScenario,
	);

	const hotInline = runHotScenario("inline full text", makeInlineScenario(999));
	const hotCollapsed = runHotScenario(
		"collapsed placeholder",
		makeCollapsedPlaceholderScenario(999),
	);

	printSummary(
		inlineResult,
		collapsedResult,
		expandedResult,
		hotInline,
		hotCollapsed,
	);
}

main();
