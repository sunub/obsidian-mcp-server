import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	type ChangePlan,
	loadPlan,
	type PlanOp,
} from "@shared/vault-ops/index.js";
import type { PlanApplyParams } from "./params.js";

const ANSWER_TIMEOUT_MS = 10 * 60 * 1000;

export type Confirmation = "approved" | "declined" | "unsupported";

export type Confirmer = (message: string) => Promise<Confirmation>;

export function elicitConfirmer(server: () => Server): Confirmer {
	return async (message) => {
		const target = server();
		if (!target.getClientCapabilities()?.elicitation?.form) {
			return "unsupported";
		}
		try {
			const answer = await target.elicitInput(
				{
					message,
					requestedSchema: {
						type: "object",
						properties: { confirm: { type: "boolean", title: "적용" } },
						required: ["confirm"],
					},
				},
				{ timeout: ANSWER_TIMEOUT_MS },
			);
			return answer.action === "accept" && answer.content?.["confirm"] === true
				? "approved"
				: "declined";
		} catch {
			return "declined";
		}
	};
}

function describeOp(op: PlanOp): string[] {
	switch (op.type) {
		case "move":
			return [`이동: ${op.from} → ${op.to}`];
		case "trash":
			return [`휴지통: ${op.path}`];
		case "removeEmptyFolder":
			return [`빈 폴더 삭제: ${op.path}`];
		case "report":
			return [];
	}
}

function describeChanges(plan: ChangePlan, params: PlanApplyParams): string[] {
	const approved = new Set(params.approvedOpIds);
	return [
		...plan.ops.filter((op) => approved.has(op.id)).flatMap(describeOp),
		...(params.renames ?? []).map(
			(rename) => `제목 변경: ${rename.path} → ${rename.title}`,
		),
	];
}

export async function approvalMessage(
	root: string,
	params: PlanApplyParams,
): Promise<string | null> {
	const plan = await loadPlan(root, params.planId);
	if (!plan) return null;
	const changes = describeChanges(plan, params);
	if (changes.length === 0) return null;
	return [`Vault에 ${changes.length}건을 적용합니다.`, ...changes].join("\n");
}
