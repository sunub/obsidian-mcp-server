import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultToolDeps } from "@shared/vault-ops/index.js";
import { registerApply } from "./apply.js";
import { registerUndo } from "./undo.js";

export { executeApply } from "./apply.js";
export { executeUndo } from "./undo.js";

export const register = (server: McpServer, deps: VaultToolDeps) => {
	registerApply(server, deps);
	registerUndo(server, deps);
};
