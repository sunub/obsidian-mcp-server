import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultToolDeps } from "@shared/vault-ops/types.js";
import CreateDocumentWithPropertyTool from "./create_document_with_properties/index.js";
import GenerateObsidianVaultPropertiesTool from "./generate_property/index.js";
import OrganizeAttachmentsTool from "./organize_attachments/index.js";
import * as TidyPlanTool from "./tidy/index.js";
import ObsidianVaultTool from "./vault/index.js";
import WriteObsidianPropertyTool from "./write_property/index.js";

export default {
	ObsidianVaultTool,
	GenerateObsidianVaultPropertiesTool,
	WriteObsidianPropertyTool,
	CreateDocumentWithPropertyTool,
	OrganizeAttachmentsTool,
};

export const toolsWithDeps: {
	register: (server: McpServer, deps: VaultToolDeps) => void;
}[] = [TidyPlanTool];
