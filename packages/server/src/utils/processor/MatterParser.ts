import { basename } from "node:path";
import matter from "gray-matter";
import type { ParsedMatter } from "@/utils/processor/types.js";
import { FrontMatterSchema } from "@/utils/processor/types.js";

export function parse(
	filePath: string,
	birthTime: string,
	text: string,
): ParsedMatter {
	try {
		const parsed = matter(text);
		const frontmatter = FrontMatterSchema.parse(parsed.data);
		return {
			frontmatter,
			content: parsed.content,
		};
	} catch {
		return {
			frontmatter: FrontMatterSchema.parse({
				title: basename(filePath, ".md"),
				date: birthTime,
				category: "any",
				tags: [""],
				summary: text.slice(0, 200).replace(/\n/g, " "),
				slug: basename(filePath, ".md").toLowerCase().replace(/\s+/g, "-"),
				completed: false,
			}),
			content: text,
		};
	}
}
