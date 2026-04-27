import { existsSync, readFileSync } from "node:fs";
import path, { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configSchema, debugLogger } from "@sunub/core";
import { z } from "zod";

const mcpServerEntrySchema = z.object({
	command: z.string().min(1),
	args: z.array(z.string()).optional().default([]),
	env: z.record(z.string(), z.string()).optional().default({}),
	cwd: z.string().optional(),
	disabled: z.boolean().optional().default(false),
});

export type McpServerEntry = z.infer<typeof mcpServerEntrySchema>;

const mcpServersFileSchema = z.object({
	mcpServers: z.record(z.string(), mcpServerEntrySchema),
});

export interface McpServerConfig {
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
	cwd?: string;
}

const ENV_VAR_PATTERN = /\$\{([^}:]+?)(?::-(.*?))?\}/g;

function substituteEnvVars(value: string): string {
	return value.replace(
		ENV_VAR_PATTERN,
		(_match: string, varName: string, defaultValue?: string): string => {
			const envValue = process.env[varName];
			if (envValue !== undefined && envValue !== "") {
				return envValue;
			}
			if (defaultValue !== undefined) {
				return defaultValue;
			}
			return "";
		},
	);
}

function substituteEnvInRecord(
	record: Record<string, string>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) {
		result[key] = substituteEnvVars(value);
	}
	return result;
}

function findConfigFile(): string | null {
	const candidates = [
		join(process.cwd(), "mcp-servers.json"),
		join(process.cwd(), ".mcp-servers.json"),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return null;
}

function buildFallbackConfig(): McpServerConfig[] {
	const parseResult = configSchema.safeParse({
		vaultPath: process.env["VAULT_DIR_PATH"],
		loggingLevel: process.env["LOGGING_LEVEL"],
		llmApiUrl: process.env["LLM_API_URL"],
		llmEmbeddingApiUrl: process.env["LLM_EMBEDDING_API_URL"],
		llmEmbeddingModel: process.env["LLM_EMBEDDING_MODEL"],
		llmChatModel: process.env["LLM_CHAT_MODEL"],
	});

	const env = parseResult.success ? parseResult.data : null;
	const vaultPath = env?.vaultPath || (process.env["VAULT_DIR_PATH"] as string);

	if (!vaultPath) {
		debugLogger.warn(
			"[McpConfig] VAULT_DIR_PATH가 설정되지 않아 폴백 서버를 생성할 수 없습니다.",
		);
		return [];
	}

	try {
		// 현재 파일 위치를 기준으로 packages/server/build/index.js 위치를 계산
		const __dirname = path.dirname(fileURLToPath(import.meta.url));
		const serverEntry = path.resolve(
			__dirname,
			"../../../server/build/index.js",
		);
		const projectRoot = path.resolve(__dirname, "../../../../");

		return [
			{
				name: "obsidian",
				command: "node",
				args: [serverEntry],
				cwd: projectRoot,
				env: {
					VAULT_DIR_PATH: vaultPath,
					LLM_API_URL: env?.llmApiUrl ?? "http://127.0.0.1:8080",
					LLM_EMBEDDING_API_URL:
						env?.llmEmbeddingApiUrl ?? "http://127.0.0.1:8081",
					LLM_EMBEDDING_MODEL: env?.llmEmbeddingModel ?? "nomic-embed-text",
					LLM_CHAT_MODEL: env?.llmChatModel ?? "llama3",
					LOGGING_LEVEL: process.env["LOGGING_LEVEL"] ?? "info",
				},
			},
		];
	} catch (err) {
		debugLogger.error("[McpConfig] 폴백 설정 생성 실패:", err);
		return [];
	}
}

export function loadMcpServersConfig(): McpServerConfig[] {
	const configPath = findConfigFile();

	if (!configPath) {
		debugLogger.warn(
			"[McpConfig] mcp-servers.json을 찾을 수 없습니다. 환경변수 폴백을 사용합니다.",
		);
		return buildFallbackConfig();
	}

	try {
		const raw = readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		const validated = mcpServersFileSchema.parse(parsed);

		const configs: McpServerConfig[] = [];

		for (const [name, entry] of Object.entries(validated.mcpServers)) {
			if (entry.disabled) {
				debugLogger.info(
					`[McpConfig] "${name}" 서버가 비활성화되어 있어 건너뜁니다.`,
				);
				continue;
			}

			configs.push({
				name,
				command: substituteEnvVars(entry.command),
				args: entry.args.map(substituteEnvVars),
				env: substituteEnvInRecord(entry.env),
				cwd: entry.cwd ? resolve(entry.cwd) : process.cwd(),
			});
		}

		debugLogger.info(
			`[McpConfig] ${configPath}에서 ${configs.length}개의 MCP 서버 설정을 로드했습니다.`,
		);

		return configs;
	} catch (err) {
		debugLogger.error(`[McpConfig] 설정 파일 파싱 실패 (${configPath}):`, err);
		debugLogger.warn("[McpConfig] 환경변수 폴백을 사용합니다.");
		return buildFallbackConfig();
	}
}
