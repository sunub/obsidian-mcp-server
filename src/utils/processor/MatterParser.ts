import matter from "gray-matter";
import type { ParsedMatter } from "./types.js";
import { FrontMatterSchema } from "./types.js";

export function parse(text: string): ParsedMatter {
	try {
		const parsed = matter(text);
		const frontmatter = FrontMatterSchema.parse(parsed.data);
		return {
			frontmatter,
			content: parsed.content,
		};
	} catch {
		console.warn(
			"Frontmatter 파싱에 실패했습니다. 전체를 내용으로 간주합니다.",
		);
		return {
			frontmatter: FrontMatterSchema.parse({}),
			content: text,
		};
	}
}
