import state from "@/config.js";
import { VaultManager } from "./VaultManager.js";

let instance: VaultManager | null = null;

export function getGlobalVaultManager(): VaultManager {
	if (instance) {
		return instance;
	}

	const vaultPath = state.vaultPath;
	if (!vaultPath) {
		throw new Error("VAULT_DIR_PATH environment variable is not set");
	}

	instance = new VaultManager(vaultPath, 20);
	return instance;
}
