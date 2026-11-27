import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	type GoldenQuery,
	mergeGradesIntoQuery,
	type RelevanceGrade,
	readGoldenSet,
	writeGoldenSet,
} from "./lib/goldenSet.js";

const DEFAULT_FILES = [
	"eval/search/queries.jsonl",
	"eval/search/queries-holdout.jsonl",
	"eval/search/queries-final.jsonl",
	"eval/search/queries-blind-labeled.jsonl",
];

const LABELS_DIR = "eval/search/results/labels-2026-11-18";

type LabelMap = Record<string, { scores?: Record<string, number> }>;

async function loadRecoverableNegatives(): Promise<Map<string, Set<string>>> {
	const byQuery = new Map<string, Set<string>>();
	const labelFiles = [
		"sonnet-labels.json",
		"sonnet-new-labels.json",
		"opus-labels.json",
		"opus-labels-part2.json",
		"opus-new-labels.json",
	];

	const addPath = (qid: string, docPath: string) => {
		const set = byQuery.get(qid) ?? new Set<string>();
		set.add(docPath);
		byQuery.set(qid, set);
	};

	for (const name of labelFiles) {
		const fullPath = join(LABELS_DIR, name);
		if (!existsSync(fullPath)) continue;
		const parsed = JSON.parse(await readFile(fullPath, "utf-8")) as LabelMap;
		for (const [qid, entry] of Object.entries(parsed)) {
			for (const docPath of Object.keys(entry.scores ?? {})) {
				addPath(qid, docPath);
			}
		}
	}

	const humanKeyPath = join(LABELS_DIR, "human_key.json");
	if (existsSync(humanKeyPath)) {
		const keys = JSON.parse(await readFile(humanKeyPath, "utf-8")) as Array<{
			qid: string;
			path: string;
		}>;
		for (const item of keys) {
			addPath(item.qid, item.path);
		}
	}

	return byQuery;
}

export function attachRecoverableZeros(
	queries: GoldenQuery[],
	judgedByQuery: Map<string, Set<string>>,
): { migrated: GoldenQuery[]; recoveredZeroCount: number } {
	let recoveredZeroCount = 0;
	const migrated = queries.map((query) => {
		const judged = judgedByQuery.get(query.id);
		if (!judged) return query;
		const zeros: Record<string, RelevanceGrade> = {};
		for (const docPath of judged) {
			if (!Object.hasOwn(query.grades, docPath)) {
				zeros[docPath] = 0;
				recoveredZeroCount++;
			}
		}
		return Object.keys(zeros).length > 0
			? mergeGradesIntoQuery(query, zeros)
			: query;
	});
	return { migrated, recoveredZeroCount };
}

function summarize(
	filePath: string,
	queries: GoldenQuery[],
	vaultPath?: string,
) {
	let g2 = 0;
	let g1 = 0;
	let g0 = 0;
	let missingFiles = 0;
	for (const q of queries) {
		for (const [doc, grade] of Object.entries(q.grades)) {
			if (grade === 2) g2++;
			else if (grade === 1) g1++;
			else g0++;
			if (vaultPath && !existsSync(join(vaultPath, doc))) {
				missingFiles++;
			}
		}
	}
	return {
		file: filePath,
		queries: queries.length,
		grade2: g2,
		grade1: g1,
		grade0: g0,
		missingFiles,
	};
}

export function pruneMissingPaths(
	queries: GoldenQuery[],
	vaultPath: string,
): { pruned: GoldenQuery[]; removedCount: number } {
	let removedCount = 0;
	const pruned = queries.map((query) => {
		const kept: Record<string, RelevanceGrade> = {};
		for (const [doc, grade] of Object.entries(query.grades)) {
			if (existsSync(join(vaultPath, doc))) {
				kept[doc] = grade;
			} else {
				removedCount++;
			}
		}
		if (Object.keys(kept).length === Object.keys(query.grades).length) {
			return query;
		}
		return mergeGradesIntoQuery(
			{ ...query, grades: {}, relevant: [], relevant_lenient: [] },
			kept,
		);
	});
	return { pruned, removedCount };
}

async function main() {
	const { values } = parseArgs({
		options: {
			files: { type: "string" },
			vault: { type: "string" },
			"prune-missing": { type: "boolean", default: false },
			"dry-run": { type: "boolean", default: false },
		},
	});

	const files = values.files
		? (values.files as string).split(",")
		: DEFAULT_FILES.filter((f) => existsSync(f));
	const vaultPath = values.vault ? resolve(values.vault as string) : undefined;
	const judgedByQuery = await loadRecoverableNegatives();

	for (const filePath of files) {
		const loaded = await readGoldenSet(filePath);
		let { migrated, recoveredZeroCount } = attachRecoverableZeros(
			loaded,
			judgedByQuery,
		);
		let prunedCount = 0;
		if (values["prune-missing"] && vaultPath) {
			const res = pruneMissingPaths(migrated, vaultPath);
			migrated = res.pruned;
			prunedCount = res.removedCount;
		}
		if (!values["dry-run"]) {
			await writeGoldenSet(filePath, migrated);
		}
		const stats = summarize(filePath, migrated, vaultPath);
		console.log(
			`${filePath} | queries=${stats.queries} | g2=${stats.grade2} g1=${stats.grade1} g0=${stats.grade0} (+${recoveredZeroCount} recovered, -${prunedCount} pruned) | missing=${stats.missingFiles}`,
		);
	}
}

const isEntry = process.argv[1]?.endsWith("migrate-golden-set.ts");
if (isEntry) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
