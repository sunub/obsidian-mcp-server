import { z } from "zod";

export const planApplyParamsSchema = z
	.object({
		planId: z.string().min(1).describe("planId returned by tidy_plan."),
		approvedOpIds: z
			.array(z.string())
			.describe(
				"Op ids from the tidy_plan preview that the user explicitly approved.",
			),
		renames: z
			.array(
				z.object({
					path: z.string().min(1),
					title: z.string(),
				}),
			)
			.optional()
			.describe(
				"Titles the user accepted for needsTitle notes. Each path must come from the plan's needsTitle list.",
			),
	})
	.describe("Parameters for applying an approved tidy plan");

export const planUndoParamsSchema = z
	.object({
		runId: z.string().min(1).describe("runId returned by plan_apply."),
	})
	.describe("Parameters for undoing a plan_apply run");

export type PlanApplyParams = z.infer<typeof planApplyParamsSchema>;
export type PlanUndoParams = z.infer<typeof planUndoParamsSchema>;
