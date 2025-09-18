import { z } from 'zod';

const PostCategorySchema = z
  .union([z.literal('web'), z.literal('algorithm'), z.literal('cs'), z.literal('code')])
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

const CacheDataSchema = z.object({
  content: z.string(),
  data: FrontMatterSchema,
  isEmpty: z.boolean(),
  excerpt: z.string(),
  cacheKey: z.string(),
  category: PostCategorySchema,
  date: DateStringSchema,
});

type PostCategory = z.infer<typeof PostCategorySchema>;
type FrontMatter = z.infer<typeof FrontMatterSchema>;
type CacheData = z.infer<typeof CacheDataSchema>;

export interface MatterTransformData {
  content: string;
  frontmatter: FrontMatter;
  contentLength: number;
  hasContent: boolean;
  imageLinks?: string[];
}

export const PostFrontMatterSchema = z.object({
  frontmatter: FrontMatterSchema,
  filePath: z.string(),
});

export interface PostFrontMatter {
  frontmatter: FrontMatter;
  filePath: string;
}

export const JsonPostFrontMatterSchema = z.object({
  all: z.array(PostFrontMatterSchema),
  web: z.array(PostFrontMatterSchema),
  algorithm: z.array(PostFrontMatterSchema),
  code: z.array(PostFrontMatterSchema),
  cs: z.array(PostFrontMatterSchema),
});

export interface JsonPostFrontMatter {
  all: PostFrontMatter[];
  web: PostFrontMatter[];
  algorithm: PostFrontMatter[];
  code: PostFrontMatter[];
  cs: PostFrontMatter[];
}

export interface ProcessedDocument {
  filePath: string;
  frontmatter: FrontMatter;
  content: string;
  contentLength: number;
  hasContent: boolean;
  imageLinks?: string[];
}

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

export const DocumentIndexResponseSchema = z.array(DocumentIndexSchema);

export { CacheDataSchema, PostCategorySchema };
export type { CacheData, FrontMatter, PostCategory };
