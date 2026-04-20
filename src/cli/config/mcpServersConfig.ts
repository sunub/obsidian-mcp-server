import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod/v4";
import { configSchema } from "@/config.js";
import { debugLogger } from "../utils/debugLogger.js";

/**
 * 단일 MCP 서버의 설정 엔트리.
 * Claude Desktop 호환 형식을 따른다.
 */
const mcpServerEntrySchema = z.object({
	command: z.string().min(1),
	args: z.array(z.string()).optional().default([]),
	env: z.record(z.string(), z.string()).optional().default({}),
	cwd: z.string().optional(),
	disabled: z.boolean().optional().default(false),
});

export type McpServerEntry = z.infer<typeof mcpServerEntrySchema>;

/** 설정 파일 전체 구조 — { mcpServers: { [name]: entry } } */
const mcpServersFileSchema = z.object({
	mcpServers: z.record(z.string(), mcpServerEntrySchema),
});

/** name이 포함된 런타임용 서버 설정 */
export interface McpServerConfig {
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
	cwd?: string;
}

// ─── 환경변수 치환 ─────────────────────────────────

const ENV_VAR_PATTERN = /\$\{([^}:]+?)(?::-(.*?))?\}/g;

/**
 * 문자열 내의 `${VAR}` 및 `${VAR:-default}` 패턴을 process.env 값으로 치환한다.
 */
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

// ─── 로더 ─────────────────────────────────────────

/**
 * mcp-servers.json 파일 경로를 탐색한다.
 * 프로젝트 루트(cwd)에서 먼저 찾고, 없으면 null을 반환한다.
 */
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

/**
 * 기존 환경변수로부터 Obsidian MCP 서버 1개의 폴백 설정을 생성한다.
 * mcp-servers.json이 없을 때의 하위 호환 경로.
 */
function buildFallbackConfig(): McpServerConfig[] {
	try {
		const env = configSchema.parse({
			vaultPath: process.env["VAULT_DIR_PATH"],
			loggingLevel: process.env["LOGGING_LEVEL"],
			llmApiUrl: process.env["LLM_API_URL"],
			llmEmbeddingApiUrl: process.env["LLM_EMBEDDING_API_URL"],
			llmEmbeddingModel: process.env["LLM_EMBEDDING_MODEL"],
			llmChatModel: process.env["LLM_CHAT_MODEL"],
		});

		if (!env.vaultPath) {
			debugLogger.warn(
				"[McpConfig] VAULT_DIR_PATH가 설정되지 않아 폴백 서버를 생성할 수 없습니다.",
			);
			return [];
		}

		const projectRoot = process.cwd();
		const serverEntry = "build/index.js";

		return [
			{
				name: "obsidian",
				command: "node",
				args: [serverEntry],
				cwd: projectRoot,
				env: {
					VAULT_DIR_PATH: env.vaultPath,
					LLM_API_URL: env.llmApiUrl ?? "http://127.0.0.1:8080",
					LLM_EMBEDDING_API_URL:
						env.llmEmbeddingApiUrl ?? "http://127.0.0.1:8081",
					LLM_EMBEDDING_MODEL: env.llmEmbeddingModel ?? "nomic-embed-text",
					LLM_CHAT_MODEL: env.llmChatModel ?? "llama3",
					LOGGING_LEVEL: process.env["LOGGING_LEVEL"] ?? "info",
				},
			},
		];
	} catch (err) {
		debugLogger.error("[McpConfig] 폴백 설정 생성 실패:", err);
		return [];
	}
}

/**
 * MCP 서버 설정을 로드한다.
 *
 * 1. 프로젝트 루트의 mcp-servers.json을 탐색
 * 2. 환경변수 치환 수행 (${VAR}, ${VAR:-default})
 * 3. disabled 서버 제외
 * 4. 파일이 없으면 기존 환경변수로 폴백 (하위 호환)
 */
export function loadMcpServersConfig(): McpServerConfig[] {
	const configPath = findConfigFile();

	if (!configPath) {
		debugLogger.log(
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
				debugLogger.log(
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

		debugLogger.log(
			`[McpConfig] ${configPath}에서 ${configs.length}개의 MCP 서버 설정을 로드했습니다.`,
		);

		return configs;
	} catch (err) {
		debugLogger.error(`[McpConfig] 설정 파일 파싱 실패 (${configPath}):`, err);
		debugLogger.log("[McpConfig] 환경변수 폴백을 사용합니다.");
		return buildFallbackConfig();
	}
}
