export class VaultPathError extends Error {
	public readonly inputPath: string;
	public readonly resolvedPath: string;
	public readonly vaultPath: string;

	constructor(inputPath: string, resolvedPath: string, vaultPath: string) {
		super("Path escapes vault boundary");
		this.name = "VaultPathError";
		this.inputPath = inputPath;
		this.resolvedPath = resolvedPath;
		this.vaultPath = vaultPath;
	}
}