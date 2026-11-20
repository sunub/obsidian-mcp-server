import type {
	ChangePlan,
	NeedsTitle,
	PlanOp,
} from "@shared/vault-ops/index.js";

export type OpView = {
	id: string;
	type: PlanOp["type"];
	path: string;
	to?: string;
	redirectTo?: string | null;
	paths?: string[];
	reason: string;
};

export type TidyPreview = {
	planId: string;
	summary: {
		bulk: number;
		per_item: number;
		report: number;
		linksAffected: number;
		needsTitle: number;
	};
	bulk: OpView[];
	per_item: OpView[];
	report: OpView[];
	needsTitle: NeedsTitle[];
};

export function toOpView(op: PlanOp): OpView {
	switch (op.type) {
		case "move":
			return {
				id: op.id,
				type: op.type,
				path: op.from,
				to: op.to,
				reason: op.reason,
			};
		case "trash":
			return {
				id: op.id,
				type: op.type,
				path: op.path,
				redirectTo: op.redirectTo,
				reason: op.reason,
			};
		case "removeEmptyFolder":
			return { id: op.id, type: op.type, path: op.path, reason: op.reason };
		case "report":
			return {
				id: op.id,
				type: op.type,
				path: op.paths[0] ?? "",
				paths: op.paths,
				reason: op.reason,
			};
	}
}

export function buildPreview(
	plan: ChangePlan,
	linksAffected: number,
): TidyPreview {
	const views = plan.ops.map((op) => ({ tier: op.tier, view: toOpView(op) }));
	const inTier = (tier: PlanOp["tier"]) =>
		views.filter((v) => v.tier === tier).map((v) => v.view);
	const bulk = inTier("bulk");
	const perItem = inTier("per_item");
	const report = inTier("report");
	return {
		planId: plan.planId,
		summary: {
			bulk: bulk.length,
			per_item: perItem.length,
			report: report.length,
			linksAffected,
			needsTitle: plan.needsTitle.length,
		},
		bulk,
		per_item: perItem,
		report,
		needsTitle: plan.needsTitle,
	};
}
