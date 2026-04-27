import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// configSchema의 모듈 수준 파싱 부작용을 방지하기 위해 모킹.
vi.mock("@core/configSchema", () => ({
	configSchema: {
		parse: vi.fn((input: Record<string, unknown>) => ({
			vaultPath: input["vaultPath"] || "",
			loggingLevel: input["loggingLevel"] || "info",
			llmApiUrl: input["llmApiUrl"] || "http://127.0.0.1:8080",
			llmEmbeddingApiUrl:
				input["llmEmbeddingApiUrl"] || "http://127.0.0.1:8081",
			llmEmbeddingModel: input["llmEmbeddingModel"] || "nomic-embed-text",
			llmChatModel: input["llmChatModel"] || "llama3",
		})),
	},
}));

import { loadMcpServersConfig } from "@cli/config/mcpServersConfig";

describe("mcpServersConfig", () => {
	const originalEnv = process.env;
	const originalCwd = process.cwd();
	let tmpDir: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-config-test-"));
		process.chdir(tmpDir);
	});

	afterEach(() => {
		process.env = originalEnv;
		process.chdir(originalCwd);
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	describe("loadMcpServersConfig — JSON 파일 파싱", () => {
		test("유효한 mcp-servers.json에서 서버 설정을 로드한다", () => {
			const configJson = JSON.stringify({
				mcpServers: {
					obsidian: {
						command: "node",
						args: ["build/index.js"],
						env: { KEY: "value" },
					},
					"web-search": {
						command: "npx",
						args: ["@mcp/server-fetch"],
						env: {},
					},
				},
			});

			fs.writeFileSync("mcp-servers.json", configJson);

			const configs = loadMcpServersConfig();

			expect(configs).toHaveLength(2);
			expect(configs[0]?.name).toBe("obsidian");
			expect(configs[0]?.command).toBe("node");
			expect(configs[0]?.args).toEqual(["build/index.js"]);
			expect(configs[1]?.name).toBe("web-search");
		});

		test("disabled 서버를 제외한다", () => {
			const configJson = JSON.stringify({
				mcpServers: {
					active: {
						command: "node",
						args: ["a.js"],
					},
					inactive: {
						command: "node",
						args: ["b.js"],
						disabled: true,
					},
				},
			});

			fs.writeFileSync("mcp-servers.json", configJson);

			const configs = loadMcpServersConfig();

			expect(configs).toHaveLength(1);
			expect(configs[0]?.name).toBe("active");
		});
	});

	describe("환경변수 치환", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: intentional for testing substitution
		test("${VAR} 패턴을 process.env에서 치환한다", () => {
			process.env["MY_PATH"] = "/custom/path";
			const configJson = JSON.stringify({
				mcpServers: {
					obsidian: {
						command: "node",
						args: ["build/index.js"],
						// biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
						env: { VAULT: "${MY_PATH}" },
					},
				},
			});

			fs.writeFileSync("mcp-servers.json", configJson);

			const configs = loadMcpServersConfig();

			expect(configs[0]?.env["VAULT"]).toBe("/custom/path");
		});

		// biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
		test("${VAR:-default} 패턴의 기본값을 지원한다", () => {
			const configJson = JSON.stringify({
				mcpServers: {
					obsidian: {
						command: "node",
						args: ["build/index.js"],
						// biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
						env: { URL: "${MY_MISSING_VAR:-http://localhost:8080}" },
					},
				},
			});

			fs.writeFileSync("mcp-servers.json", configJson);

			const configs = loadMcpServersConfig();

			expect(configs[0]?.env["URL"]).toBe("http://localhost:8080");
		});

		test("환경변수가 있으면 기본값 대신 환경변수를 사용한다", () => {
			process.env["MY_URL"] = "http://real-server:9090";
			const configJson = JSON.stringify({
				mcpServers: {
					obsidian: {
						command: "node",
						args: ["build/index.js"],
						// biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
						env: { URL: "${MY_URL:-http://localhost:8080}" },
					},
				},
			});

			fs.writeFileSync("mcp-servers.json", configJson);

			const configs = loadMcpServersConfig();

			expect(configs[0]?.env["URL"]).toBe("http://real-server:9090");
		});

		test("존재하지 않는 환경변수(기본값 없음)는 빈 문자열로 치환된다", () => {
			const configJson = JSON.stringify({
				mcpServers: {
					obsidian: {
						command: "node",
						args: ["build/index.js"],
						// biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
						env: { EMPTY: "${NONEXISTENT_VAR}" },
					},
				},
			});

			fs.writeFileSync("mcp-servers.json", configJson);

			const configs = loadMcpServersConfig();

			expect(configs[0]?.env["EMPTY"]).toBe("");
		});
	});

	describe("폴백 (하위 호환)", () => {
		test("mcp-servers.json이 없으면 환경변수에서 Obsidian 서버를 생성한다", () => {
			process.env["VAULT_DIR_PATH"] = "/env/vault";

			const configs = loadMcpServersConfig();

			expect(configs).toHaveLength(1);
			expect(configs[0]?.name).toBe("obsidian");
			expect(configs[0]?.env["VAULT_DIR_PATH"]).toBe("/env/vault");
		});

		test("JSON 파싱 실패 시 폴백을 사용한다", () => {
			process.env["VAULT_DIR_PATH"] = "/env/vault";
			fs.writeFileSync("mcp-servers.json", "invalid-json");

			const configs = loadMcpServersConfig();

			expect(configs).toHaveLength(1);
			expect(configs[0]?.name).toBe("obsidian");
		});
	});

	describe("빈 설정", () => {
		test("mcpServers가 빈 객체면 빈 배열을 반환한다", () => {
			const configJson = JSON.stringify({ mcpServers: {} });
			fs.writeFileSync("mcp-servers.json", configJson);

			const configs = loadMcpServersConfig();

			expect(configs).toHaveLength(0);
		});
	});
});
