import { basename } from "node:path";
import matter from "gray-matter";
import type { ParsedMatter } from "@/utils/processor/types.js";
import { FrontMatterSchema } from "@/utils/processor/types.js";

export function parse(
	filePath: string,
	birthTime: string,
	text: string,
): ParsedMatter {
	const parsed = matter(text);
	const result = FrontMatterSchema.safeParse(parsed.data);

	if (result.success) {
		return {
			frontmatter: result.data,
			content: parsed.content,
		};
	}

	// gray-matter 파싱 자체가 실패한 극단적 케이스 (예: 바이너리 파일 혼입 등)
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
