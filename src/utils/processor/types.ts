import { z } from "zod";

const PostCategorySchema = z
	.union([
		z.literal("web"),
		z.literal("algorithm"),
		z.literal("cs"),
		z.literal("code"),
	])
	.optional();

const DateStringSchema = z.union([z.string(), z.date()]).optional();

export const FrontMatterSchema = z.object({
	title: z.string().optional(),
	date: DateStringSchema,
	tags: z.array(z.string()).optional(),
	summary: z.string().optional(),
	slug: z.string().optional(),
	category: PostCategorySchema,
	completed: z.boolean().optional(),
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
	imageLinks: string[];
	documentLinks: string[];
}

export const DocumentIndexSchema = z.object({
	filePath: z.string(),
	frontmatter: FrontMatterSchema,
	contentLength: z.number(),
	imageLinks: z.array(z.string()),
	documentLinks: z.array(z.string()),
});

export { PostCategorySchema };
export type { FrontMatter };
