import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../package.json" with { type: "json" };
import tools from "./tools/index.js";

export default function createMcpServer(): McpServer {
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
	        - vault: Search, read, list, and semantic search markdown documents in the vault
	          * action="search_vault_by_semantic": Find documents by meaning using a natural language query.
	          * action="index_vault_to_vectordb": Manually trigger a full vault re-indexing.
	        - generate_property: Generate frontmatter property suggestions from document content
	        - write_property: Write frontmatter properties to a markdown file
	        - create_document_with_properties: Two-step workflow for AI-generated properties and write
	        - organize_attachments: Move linked attachments and update markdown links
	        
	        Environment requirements:
	        - VAULT_DIR_PATH: Path to your Obsidian vault directory
	        - LLM_API_URL: (Optional) llama.cpp chat server URL (default: http://127.0.0.1:8080)
	        - LLM_EMBEDDING_API_URL: (Optional) llama.cpp embedding server URL (default: http://127.0.0.1:8081)
	        - LLM_EMBEDDING_MODEL: (Optional) Embedding model name (default: nomic-embed-text)
	        - LLM_CHAT_MODEL: (Optional) Chat model name (default: llama3)
	      `,
		},
	);

	for (const tool of Object.values(tools)) {
		tool.register(mcpServer);
	}

	return mcpServer;
}
