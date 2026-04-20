import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { debugLogger } from "../utils/debugLogger.js";
import type { McpToolResult } from "../types.js";

export interface McpConnectionOptions {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
}

export interface McpToolInputSchema {
	type: string;
	properties?: Record<string, { type?: string; description?: string }>;
	required?: string[];
}

export interface McpToolInfo {
	name: string;
	description?: string;
	inputSchema?: McpToolInputSchema;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export class McpClientService {
	private client: Client | null = null;
	private transport: StdioClientTransport | null = null;
	private _isConnected = false;

	get isConnected(): boolean {
		return this._isConnected;
	}

	async connect(options: McpConnectionOptions): Promise<void> {
		if (this._isConnected) {
			debugLogger.debug("[McpClient] Already connected, skipping.");
			return;
		}

		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			try {
				debugLogger.debug(
					`[McpClient] Connection attempt ${attempt}/${MAX_RETRIES}...`,
				);

				this.transport = new StdioClientTransport({
					command: options.command,
					args: options.args,
					env: Object.fromEntries(
						Object.entries({ ...process.env, ...options.env }).filter(
							(entry): entry is [string, string] => entry[1] !== undefined,
						),
					),
					cwd: options.cwd,
					stderr: "pipe",
				});

				this.client = new Client({
					name: "obsidian-cli-agent",
					version: "1.0.0",
				});

				this.transport.stderr?.on("data", (chunk: Buffer) => {
					const text = chunk.toString().trim();
					if (!text) {
						return;
					}

					if (
						!text.startsWith("File added:") &&
						!text.startsWith("Frontmatter")
					) {
						debugLogger.debug(`[McpServer:stderr] ${text}`);
					}
				});

				await this.client.connect(this.transport);
				this._isConnected = true;

				debugLogger.info("[McpClient] Successfully connected to MCP server.");
				return;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				debugLogger.error(
					`[McpClient] Connection attempt ${attempt} failed:`,
					lastError.message,
				);

				await this.cleanupResources();

				if (attempt < MAX_RETRIES) {
					await sleep(RETRY_DELAY_MS * attempt);
				}
			}
		}

		throw new Error(
			`MCP 서버 연결 실패 (${MAX_RETRIES}회 시도): ${lastError?.message ?? "Unknown error"}`,
		);
	}

	async listTools(): Promise<McpToolInfo[]> {
		this.ensureConnected();
		const client = this.client as Client;

		const result = await client.listTools();
		return result.tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema as McpToolInputSchema | undefined,
		}));
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<McpToolResult> {
		this.ensureConnected();
		const client = this.client as Client;

		debugLogger.debug(
			`[McpClient] Calling tool: ${name}`,
			JSON.stringify(args).slice(0, 200),
		);

		try {
			const result = await client.callTool({ name, arguments: args });

			debugLogger.debug(
				`[McpClient] Tool ${name} completed (isError: ${result.isError ?? false})`,
			);

			return {
				isError: (result.isError as boolean | undefined) ?? false,
				content: (result.content ?? []) as Array<{
					type: string;
					text?: string;
				}>,
			};
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			debugLogger.error(`[McpClient] Tool ${name} failed:`, errorMessage);

			return {
				isError: true,
				content: [{ type: "text", text: `도구 실행 실패: ${errorMessage}` }],
			};
		}
	}

	async disconnect(): Promise<void> {
		debugLogger.info("[McpClient] Disconnecting...");

		try {
			if (this.client) {
				await this.client.close();
			}
		} catch (err) {
			debugLogger.error("[McpClient] Error during client close:", err);
		}

		await this.cleanupResources();
		debugLogger.info("[McpClient] Disconnected.");
	}

	private ensureConnected(): void {
		if (!this._isConnected || !this.client) {
			throw new Error(
				"MCP 클라이언트가 연결되지 않았습니다. connect()를 먼저 호출하세요.",
			);
		}
	}

	private async cleanupResources(): Promise<void> {
		try {
			if (this.transport) {
				await this.transport.close();
			}
		} catch {
		}
		this.client = null;
		this.transport = null;
		this._isConnected = false;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
