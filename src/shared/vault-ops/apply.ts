import type { ApplyRequest, ApplyResult, UndoResult } from "./types.js";

export async function applyPlan(
	_root: string,
	_request: ApplyRequest,
): Promise<ApplyResult> {
	throw new Error("not implemented");
}

export async function undoRun(
	_root: string,
	_runId: string,
): Promise<UndoResult> {
	throw new Error("not implemented");
}
