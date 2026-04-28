import { z } from "zod";

const PostCategorySchema = z.string().optional();

const DateStringSchema = z.union([z.string(), z.date()]).optional();

// 파싱/인덱싱용 — vault 문서의 frontmatter는 어떤 형태든 허용
export const FrontMatterSchema = z
	.object({
		title: z.string().optional(),
		date: DateStringSchema,
		tags: z.array(z.string()).optional(),
		summary: z.string().optional(),
		slug: z.string().optional(),
		category: PostCategorySchema,
		completed: z.boolean().optional(),
	})
	.passthrough();

// 응답 검증용 — formatDocument가 title/tags fallback을 항상 보장
export const FormattedMetadataSchema = FrontMatterSchema.extend({
	title: z.string(),
	tags: z.array(z.string()),
});

type FrontMatter = z.infer<typeof FrontMatterSchema>;

export interface ParsedMatter {
	frontmatter: FrontMatter;
	content: string;
}

export interface DocumentIndex {
	filePath: string;
	frontmatter: FrontMatter;
	contentLength: number;
	mtime: number;
	imageLinks: string[];
	documentLinks: string[];
}

export const DocumentIndexSchema = z.object({
	filePath: z.string(),
	frontmatter: FrontMatterSchema,
	contentLength: z.number(),
	mtime: z.number(),
	imageLinks: z.array(z.string()),
	documentLinks: z.array(z.string()),
});

export type FormattedMetadata = z.infer<typeof FormattedMetadataSchema>;
export { PostCategorySchema };
export type { FrontMatter };
