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
	        - vault: Search, read, and list markdown documents in the vault
	        - generate_property: Generate frontmatter property suggestions from document content
	        - write_property: Write frontmatter properties to a markdown file
	        - create_document_with_properties: Two-step workflow for AI-generated properties and write
	        - organize_attachments: Move linked attachments and update markdown links
	        
	        Environment requirements:
	        - VAULT_DIR_PATH: Path to your Obsidian vault directory
	      `,
		},
	);

	for (const tool of Object.values(tools)) {
		tool.register(mcpServer);
	}

	return mcpServer;
}
