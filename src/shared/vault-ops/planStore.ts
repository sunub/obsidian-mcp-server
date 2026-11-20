import {
	isSafeId,
	readJsonOrNull,
	storePath,
	writeJsonAtomic,
} from "./jsonFile.js";
import type { ChangePlan } from "./types.js";

export async function savePlan(root: string, plan: ChangePlan): Promise<void> {
	if (!isSafeId(plan.planId)) throw new Error(`invalid planId: ${plan.planId}`);
	await writeJsonAtomic(storePath(root, "plans", plan.planId), plan);
}

export async function loadPlan(
	root: string,
	planId: string,
): Promise<ChangePlan | null> {
	if (!isSafeId(planId)) return null;
	return readJsonOrNull<ChangePlan>(storePath(root, "plans", planId));
}
