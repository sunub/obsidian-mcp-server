import { describe, expect, test } from "vitest";
import { obsidianContentQueryParamsZod } from "../../src/tools/vault/params.js";

describe("Vault read parameters", () => {
	test("rejects the removed query parameter", () => {
		const parsed = obsidianContentQueryParamsZod.safeParse({
			action: "read",
			filename: "beta.md",
			query: "apple",
		});

		expect(parsed.success).toBe(false);
	});
});
