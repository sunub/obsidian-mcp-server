import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "@huggingface/transformers";
import { MODELS_DIR } from "@shared/paths/appData.js";
import { DEFAULT_LOW_CONFIDENCE_DENSE_THRESHOLD } from "@shared/search-backend/lowConfidence.js";
import { Command } from "commander";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ debug: false, quiet: true });

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
	vaultPath: vaultPathSchema,
	loggingLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ObsidianMcpConfig = z.infer<typeof configSchema>;

const lowConfidenceDenseThresholdSchema = z
	.string()
	.trim()
	.min(1)
	.pipe(z.coerce.number().min(0).max(1));

export function parseLowConfidenceDenseThreshold(
	raw: string | undefined,
): number {
	if (raw === undefined) {
		return DEFAULT_LOW_CONFIDENCE_DENSE_THRESHOLD;
	}
	const parsed = lowConfidenceDenseThresholdSchema.safeParse(raw);
	if (!parsed.success) {
		console.error(
			`[config] LOW_CONFIDENCE_DENSE_THRESHOLD must be a number between 0 and 1, got "${raw}". Using ${DEFAULT_LOW_CONFIDENCE_DENSE_THRESHOLD}.`,
		);
		return DEFAULT_LOW_CONFIDENCE_DENSE_THRESHOLD;
	}
	return parsed.data;
}

export const lowConfidenceDenseThreshold = parseLowConfidenceDenseThreshold(
	process.env["LOW_CONFIDENCE_DENSE_THRESHOLD"],
);

const _rawConfig = {
	vaultPath: process.env["VAULT_DIR_PATH"] || "",
	loggingLevel: "info" as const,
};

const _parseResult = configSchema.safeParse(_rawConfig);

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
		.allowUnknownOption()
		.allowExcessArguments(true)
		.parse(process.argv);
	const options = program.opts();
	const parseResult = configSchema.safeParse(options);

	if (!parseResult.success) {
		console.error("Configuration Error:");
		parseResult.error.issues.forEach((issue) => {
			console.error(` - ${issue.path.join(".")}: ${issue.message}`);
		});

		console.error(
			"\n사용 방법: Environment variables 에 VAULT_DIR_PATH 설정 또는 명령줄 인수 --vault-path <path>를 통해 올바른 구성을 제공하세요.",
		);
		return false;
	}

	state.vaultPath = parseResult.data.vaultPath;
	state.loggingLevel = parseResult.data.loggingLevel;

	return state;
}

export function setLocalLLMEnvSetting() {
	env.localModelPath = MODELS_DIR;
	env.cacheDir = MODELS_DIR;
	env.allowRemoteModels = false;
}

export default state;
