import state from "@/config.js";
import { VaultManager } from "@/utils/VaultManger/VaultManager.js";

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

/**
 * 테스트용: 기존 인스턴스를 초기화합니다.
 */
export function clearVaultManagerInstance(): void {
	instance = null;
}
