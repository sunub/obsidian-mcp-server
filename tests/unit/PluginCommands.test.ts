import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { describe, expect, test } from "vitest";

const COMMANDS_DIR = join(process.cwd(), "plugin", "commands");

describe("plugin slash commands", () => {
	test("provides exactly the four expected command markdown files", async () => {
		const entries = (await readdir(COMMANDS_DIR))
			.filter((name) => name.endsWith(".md"))
			.sort();

		expect(entries).toEqual(["reindex.md", "status.md", "tidy.md", "undo.md"]);
	});

	test.each([
		{ file: "tidy.md", argumentHint: "[scope]" },
		{ file: "undo.md", argumentHint: "[runId]" },
		{ file: "status.md", argumentHint: undefined },
		{ file: "reindex.md", argumentHint: "[--force]" },
	])("$file has valid manual-only frontmatter and body", async ({
		file,
		argumentHint,
	}) => {
		const raw = await readFile(join(COMMANDS_DIR, file), "utf-8");
		const parsed = matter(raw);

		expect(typeof parsed.data.description).toBe("string");
		expect(parsed.data.description.trim().length).toBeGreaterThan(0);
		expect(parsed.data["disable-model-invocation"]).toBe(true);
		expect(parsed.data["argument-hint"]).toBe(argumentHint);
		expect(parsed.content.trim().length).toBeGreaterThan(0);
	});
});
