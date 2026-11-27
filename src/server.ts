import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerLifecycle } from "@shared/lifecycle/ServerLifecycle.js";
import type { VaultToolDeps } from "@shared/vault-ops/types.js";
import pkg from "../package.json" with { type: "json" };
import state from "./config.js";
import tools, { toolsWithDeps } from "./tools/index.js";

type ToolConfig = {
	title?: string;
	description?: string;
	inputSchema?: unknown;
	outputSchema?: unknown;
	annotations?: unknown;
	_meta?: Record<string, unknown>;
};
type RawToolCallback = (...args: unknown[]) => unknown;
type RawRegisterTool = (
	name: string,
	config: ToolConfig,
	callback: RawToolCallback,
) => RegisteredTool;

export default function createMcpServer(lifecycle: ServerLifecycle): McpServer {
	const mcpServer = new McpServer(
		{
			version: pkg.version,
			name: "obsidian-mcp-server",
			title: "Obsidian MCP Server",
		},
		{
			capabilities: {
				logging: {},
				tools: { listChanged: false },
			},
			instructions:
				"Search, read, and tidy the Obsidian vault at VAULT_DIR_PATH, and write frontmatter properties to its notes.",
		},
	);

	const registerTool = mcpServer.registerTool.bind(
		mcpServer,
	) as unknown as RawRegisterTool;

	mcpServer.registerTool = ((name, config, callback) => {
		const rawCallback = callback as RawToolCallback;
		const wrappedCallback: RawToolCallback = (...args) =>
			lifecycle.runToolCall(name, () => Promise.resolve(rawCallback(...args)));

		return registerTool(name, config, wrappedCallback);
	}) as typeof mcpServer.registerTool;

	for (const tool of Object.values(tools)) {
		tool.register(mcpServer);
	}

	const deps: VaultToolDeps = { vaultRoot: () => state.vaultPath };
	for (const tool of toolsWithDeps) {
		tool.register(mcpServer, deps);
	}

	return mcpServer;
}
