import { z } from "zod";
import { PLANNER_NAMES } from "./buildPlan.js";

export const tidyPlanParamsSchema = z
	.object({
		scope: z
			.string()
			.optional()
			.describe(
				"Name of one top-level vault folder to limit the plan to. Omit to plan the whole vault.",
			),
		planners: z
			.array(z.enum(PLANNER_NAMES))
			.optional()
			.describe(
				"Which checks to run. Defaults to all: duplicates, untitled, attachments, emptyFolders.",
			),
		attachmentsFolderName: z
			.string()
			.optional()
			.describe(
				'Name of the folder placed next to a note to hold its attachments. Defaults to "attachments".',
			),
	})
	.describe("Parameters for building a vault tidy plan");

export type TidyPlanParams = z.infer<typeof tidyPlanParamsSchema>;
