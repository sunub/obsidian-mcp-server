import path from "node:path";
import { env } from "@huggingface/transformers";
import type { ObsidianMcpConfig } from "@sunub/core";
import { configSchema } from "@sunub/core";
import { Command } from "commander";
import dotenv from "dotenv";
import type { z } from "zod";
import { MODELS_DIR } from "@/utils/constants.js";

const rootEnvPath = path.resolve(import.meta.dirname, "../../../.env");
dotenv.config({ path: rootEnvPath, debug: false, quiet: true });

const _rawConfig = {
	vaultPath: process.env["VAULT_DIR_PATH"] || "",
	loggingLevel: "info" as const,
	llmApiUrl: process.env["LLM_API_URL"] || "http://127.0.0.1:8080",
	llmEmbeddingApiUrl:
		process.env["LLM_EMBEDDING_API_URL"] || "http://127.0.0.1:8081",
	llmEmbeddingModel: process.env["LLM_EMBEDDING_MODEL"] || "nomic-embed-text",
	llmChatModel: process.env["LLM_CHAT_MODEL"] || "llama3",
	llmRerankerApiUrl:
		process.env["LLM_RERANKER_API_URL"] || "http://127.0.0.1:8082",
};

const _parseResult = configSchema.safeParse(_rawConfig);

// safeParse를 사용하여 모듈 로드 시점에 throw하지 않는다.
// 유효한 환경(프로덕션 CLI)에서는 getOptions()가 전체 검증을 수행한다.
// 테스트 환경에서는 beforeAll에서 state.vaultPath를 직접 할당한다.
const state: ObsidianMcpConfig = _parseResult.success
	? _parseResult.data
	: (_rawConfig as unknown as ObsidianMcpConfig);

export function getOptions(): ObsidianMcpConfig | false {
	const program = new Command()
		.name("obsidian-mcp-server")
		.description("MCP Server for Obsidian Vault")
		.option(
			"--vault-path <path>",
			"Path to the Obsidian vault directory",
			process.env["VAULT_DIR_PATH"] ?? "",
		)
		.option(
			"--logging-level <level>",
			"Logging level (debug, info, warn, error)",
			process.env["LOGGING_LEVEL"] ?? "info",
		)
		.option(
			"--llm-api-url <url>",
			"LLM Chat API URL",
			process.env["LLM_API_URL"] ?? "http://127.0.0.1:8080",
		)
		.option(
			"--llm-embedding-api-url <url>",
			"LLM Embedding API URL",
			process.env["LLM_EMBEDDING_API_URL"] ?? "http://127.0.0.1:8081",
		)
		.option(
			"--llm-embedding-model <model>",
			"LLM Embedding Model",
			process.env["LLM_EMBEDDING_MODEL"] ?? "nomic-embed-text",
		)
		.option(
			"--llm-chat-model <model>",
			"LLM Chat Model",
			process.env["LLM_CHAT_MODEL"] ?? "llama3",
		)
		.allowUnknownOption()
		.parse(process.argv);
	const options = program.opts();
	const parseResult = configSchema.safeParse(options);

	if (!parseResult.success) {
		console.error("Configuration Error:");
		parseResult.error.issues.forEach((issue: z.ZodIssue) => {
			console.error(` - ${issue.path.join(".")}: ${issue.message}`);
		});

		console.error(
			"\n사용 방법: Environment variables 에 VAULT_DIR_PATH 설정 또는 명령줄 인수 --vault-path <path>를 통해 올바른 구성을 제공하세요.",
		);
		return false;
	}

	state.vaultPath = parseResult.data.vaultPath;
	state.loggingLevel = parseResult.data.loggingLevel;
	state.llmApiUrl = parseResult.data.llmApiUrl;
	state.llmEmbeddingApiUrl = parseResult.data.llmEmbeddingApiUrl;
	state.llmEmbeddingModel = parseResult.data.llmEmbeddingModel;
	state.llmChatModel = parseResult.data.llmChatModel;

	return state;
}

export function setLocalLLMEnvSetting() {
	env.localModelPath = MODELS_DIR;
	env.cacheDir = MODELS_DIR;
	env.allowRemoteModels = false;
}

export default state;
