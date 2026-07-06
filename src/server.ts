import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../package.json" with { type: "json" };
import tools from "./tools/index.js";
import type { ServerLifecycle } from "./utils/ServerLifecycle.js";

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
			instructions: `
	        This server provides access to Obsidian vault documents and related tools.
	        
	        Available tools:
	        - vault: Search, read, list, and index documents in the vault.
	          * action="search": Unified hybrid search (Keyword + Semantic + Reranking). Automatically falls back to keyword search if local models are missing.
	          * action="read": Read a specific document's content and metadata.
	          * action="list_all": List all documents in the vault.
	          * action="index_vault_to_vectordb": Manually trigger a full vault re-indexing for semantic search.
	        - generate_property: Generate frontmatter property suggestions from document content.
	        - write_property: Write frontmatter properties to a markdown file.
	        - create_document_with_properties: Two-step workflow for AI-generated properties and write.
	        - organize_attachments: Move linked attachments and update markdown links.
	        
	        Environment requirements:
	        - VAULT_DIR_PATH: Path to your Obsidian vault directory.
	        - LLM_API_URL: (Optional) Remote chat server URL (default: http://127.0.0.1:8080).
	        
	        Local Search Optimization:
	        - To enable high-performance local hybrid search, run 'npx @sunub/obsidian-mcp-server setup' once.
	      `,
		},
	);

	const registerTool = mcpServer.registerTool.bind(
		mcpServer,
	) as unknown as RawRegisterTool;

	mcpServer.registerTool = ((name, config, callback) => {
		const rawCallback = callback as RawToolCallback;
		const wrappedCallback: RawToolCallback = (...args) =>
			lifecycle.runToolCall(name, () =>
				Promise.resolve(rawCallback(...args)),
			);

		return registerTool(name, config, wrappedCallback);
	}) as typeof mcpServer.registerTool;

	for (const tool of Object.values(tools)) {
		tool.register(mcpServer);
	}

	return mcpServer;
}
