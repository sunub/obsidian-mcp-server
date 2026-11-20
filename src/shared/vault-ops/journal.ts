import {
	isSafeId,
	readJsonOrNull,
	storePath,
	writeJsonAtomic,
} from "./jsonFile.js";
import type { RunJournal } from "./types.js";

export async function writeJournal(
	root: string,
	journal: RunJournal,
): Promise<void> {
	if (!isSafeId(journal.runId))
		throw new Error(`invalid runId: ${journal.runId}`);
	await writeJsonAtomic(storePath(root, "runs", journal.runId), journal);
}

export async function readJournal(
	root: string,
	runId: string,
): Promise<RunJournal | null> {
	if (!isSafeId(runId)) return null;
	return readJsonOrNull<RunJournal>(storePath(root, "runs", runId));
}
