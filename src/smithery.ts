import configState, { configSchema } from "./config.js";
import createMcpServer from "./server.js";

type SmitheryEntryArgs = {
	config?: unknown;
};

export { configSchema };
export const stateless = true;

export default function createSmitheryServer({ config }: SmitheryEntryArgs) {
	const configInput =
		typeof config === "object" && config !== null
			? (config as Record<string, unknown>)
			: {};
	const parseResult = configSchema.safeParse({
		vaultPath: process.env.VAULT_DIR_PATH ?? "",
		loggingLevel: process.env.LOGGING_LEVEL ?? "info",
		...configInput,
	});

	if (!parseResult.success) {
		const details = parseResult.error.issues
			.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
			.join("; ");
		throw new Error(`Invalid Smithery config - ${details}`);
	}

	configState.vaultPath = parseResult.data.vaultPath;
	configState.loggingLevel = parseResult.data.loggingLevel;

	return createMcpServer().server;
}
