import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const vaultPathSchema = z
	.string()
	.min(1, "Vault path는 비어 있을 수 없습니다.")
	.trim()
	.transform((val) => resolve(val)) // 입력받은 경로를 절대 경로로 변환
	.refine((val) => existsSync(val), {
		message: "파일 시스템에 해당 경로가 존재하지 않습니다.",
	})
	.refine(
		(val) => {
			try {
				return statSync(val).isDirectory();
			} catch {
				return false;
			}
		},
		{
			message: "지정된 경로가 디렉토리가 아닙니다.",
		},
	);

export const configSchema = z.object({
	vaultPath: vaultPathSchema.optional(), // Allow optional for CLI fallback building
	loggingLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
	llmApiUrl: z.string().url().default("http://127.0.0.1:8080"),
	llmEmbeddingApiUrl: z.string().url().default("http://127.0.0.1:8081"),
	llmEmbeddingModel: z.string().default("nomic-embed-text"),
	llmChatModel: z.string().default("llama3"),
	llmRerankerApiUrl: z.string().url().default("http://127.0.0.1:8082"),
});

export type ObsidianMcpConfig = z.infer<typeof configSchema>;
