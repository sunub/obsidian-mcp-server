import os from "node:os";
import dotenv from "dotenv";

dotenv.config({ debug: false });

export const VAULT_DIR_PATH = process.env.VAULT_DIR_PATH || "";

function isWindowsPath(path: string): boolean {
	return os.platform() === "win32" && /^[a-zA-Z]:\\/.test(path);
}

function parseWindosPathToLinux(path: string): string {
	if (!isWindowsPath(path)) {
		throw new Error("Not a valid Windows path");
	}

	const driveLetter = path[0].toLowerCase();
	const pathWithoutDrive = path.slice(2).replace(/\\/g, "/");
	return `/mnt/${driveLetter}/${pathWithoutDrive}`;
}

export const getParsedVaultPath = () =>
	isWindowsPath(VAULT_DIR_PATH)
		? parseWindosPathToLinux(VAULT_DIR_PATH)
		: VAULT_DIR_PATH;
