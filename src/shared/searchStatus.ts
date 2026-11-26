import { z } from "zod";

export const SEARCH_SETUP_COMMAND = "npx @sunub/obsidian-mcp-server setup";

export const searchStatusSchema = z
	.object({
		mode: z
			.enum(["hybrid", "keyword"])
			.describe("keyword means semantic search did not contribute"),
		reason: z.enum(["models_missing", "semantic_unavailable"]).optional(),
		setup_command: z
			.string()
			.optional()
			.describe("Command that installs the local search models"),
		indexing: z
			.object({
				progress: z.number(),
				processed: z.number(),
				total: z.number(),
			})
			.optional()
			.describe("Present while semantic indexing is still running"),
	})
	.describe("How this search was executed");

export type SearchStatus = z.infer<typeof searchStatusSchema>;
