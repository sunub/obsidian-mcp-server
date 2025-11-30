import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import dotenv from "dotenv";
import { z } from "zod/v4";

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

const state: ObsidianMcpConfig = {
	vaultPath: process.env.VAULT_DIR_PATH || "",
	loggingLevel: "info",
};

export function getOptions(): ObsidianMcpConfig | false {
	const program = new Command()
		.name("obsidian-mcp-server")
		.description("MCP Server for Obsidian Vault")
		.option(
			"--vault-path <path>",
			"Path to the Obsidian vault directory",
			process.env.VAULT_DIR_PATH ?? "",
		)
		.option(
			"--logging-level <level>",
			"Logging level (debug, info, warn, error)",
			process.env.LOGGING_LEVEL ?? "info",
		)
		.allowUnknownOption()
		.parse(process.argv);
	const options = program.opts();
	const parseResult = configSchema.safeParse(options);

	if (!parseResult.success) {
		console.error("Configuration Error:");
		parseResult.error.issues.forEach((issue) => {
			console.error(` - ${issue.path.join(".")}: ${issue.message}`);
		});

		console.info(
			"\n사용 방법: Environment variables 에 VAULT_DIR_PATH 설정 또는 명령줄 인수 --vault-path <path>를 통해 올바른 구성을 제공하세요.",
		);
		return false;
	}

	state.vaultPath = parseResult.data.vaultPath;
	state.loggingLevel = parseResult.data.loggingLevel;

	return state;
}

export default state;
