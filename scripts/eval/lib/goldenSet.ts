import { readFile, writeFile } from "node:fs/promises";

export type RelevanceGrade = 0 | 1 | 2;

export interface RawGoldenQuery {
	id: string;
	type: string;
	query: string;
	relevant?: string[];
	relevant_lenient?: string[];
	grades?: Record<string, RelevanceGrade>;
	note?: string;
}

export interface GoldenQuery {
	id: string;
	type: string;
	query: string;
	grades: Record<string, RelevanceGrade>;
	relevant: string[];
	relevant_lenient: string[];
	note?: string;
}

export function deriveRelevantFromGrades(
	grades: Record<string, RelevanceGrade>,
): { relevant: string[]; relevant_lenient: string[] } {
	const entries = Object.entries(grades).sort(([a], [b]) => a.localeCompare(b));
	const relevant: string[] = [];
	const relevant_lenient: string[] = [];
	for (const [doc, grade] of entries) {
		if (grade >= 2) relevant.push(doc);
		if (grade >= 1) relevant_lenient.push(doc);
	}
	return { relevant, relevant_lenient };
}

export function normalizeGoldenQuery(raw: RawGoldenQuery): GoldenQuery {
	const grades: Record<string, RelevanceGrade> = {};

	if (raw.grades) {
		for (const [doc, grade] of Object.entries(raw.grades)) {
			if (grade === 0 || grade === 1 || grade === 2) {
				grades[doc] = grade;
			}
		}
	}

	for (const doc of raw.relevant_lenient ?? []) {
		if (grades[doc] === undefined || grades[doc] < 1) {
			grades[doc] = 1;
		}
	}

	for (const doc of raw.relevant ?? []) {
		grades[doc] = 2;
	}

	const sortedGrades: Record<string, RelevanceGrade> = {};
	for (const key of Object.keys(grades).sort()) {
		sortedGrades[key] = grades[key] as RelevanceGrade;
	}

	const derived = deriveRelevantFromGrades(sortedGrades);
	const result: GoldenQuery = {
		id: raw.id,
		type: raw.type,
		query: raw.query,
		grades: sortedGrades,
		relevant: derived.relevant,
		relevant_lenient: derived.relevant_lenient,
	};
	if (raw.note !== undefined) {
		result.note = raw.note;
	}
	return result;
}

export function mergeGradesIntoQuery(
	query: GoldenQuery,
	updates: Record<string, RelevanceGrade>,
): GoldenQuery {
	const merged: Record<string, RelevanceGrade> = { ...query.grades };
	for (const [doc, grade] of Object.entries(updates)) {
		if (grade === 0 || grade === 1 || grade === 2) {
			merged[doc] = grade;
		}
	}
	const sortedGrades: Record<string, RelevanceGrade> = {};
	for (const key of Object.keys(merged).sort()) {
		sortedGrades[key] = merged[key] as RelevanceGrade;
	}
	const derived = deriveRelevantFromGrades(sortedGrades);
	const result: GoldenQuery = {
		id: query.id,
		type: query.type,
		query: query.query,
		grades: sortedGrades,
		relevant: derived.relevant,
		relevant_lenient: derived.relevant_lenient,
	};
	if (query.note !== undefined) {
		result.note = query.note;
	}
	return result;
}

export async function readGoldenSet(filePath: string): Promise<GoldenQuery[]> {
	const raw = await readFile(filePath, "utf-8");
	return raw
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => normalizeGoldenQuery(JSON.parse(line) as RawGoldenQuery));
}

export async function writeGoldenSet(
	filePath: string,
	queries: GoldenQuery[],
): Promise<void> {
	const body = `${queries.map((q) => JSON.stringify(q)).join("\n")}\n`;
	await writeFile(filePath, body, "utf-8");
}
