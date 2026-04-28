export class UnknownCommandError extends Error {
	constructor(command: string) {
		super(`Unknown command: ${command}`);
		this.name = "UnknownCommandError";
	}
}
