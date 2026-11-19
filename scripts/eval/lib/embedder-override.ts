import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "@huggingface/transformers";

export type EmbedderOverrideOptions = {
	modelName?: string;
	modelsDir?: string;
	prefix?: string;
};

type OverridableEmbedder = {
	modelName: string;
	embed(text: string): Promise<number[]>;
	init(): Promise<void>;
	checkModelPresence(): Promise<boolean>;
	hasLocalModelFiles(): boolean;
};

export function applyEmbedderOverride(
	embedder: OverridableEmbedder,
	options: EmbedderOverrideOptions,
): void {
	if (options.modelName) {
		(embedder as { modelName: string }).modelName = options.modelName;
	}
	const modelsDir = options.modelsDir;
	if (modelsDir) {
		const hasFiles = () => existsSync(join(modelsDir, embedder.modelName));
		embedder.hasLocalModelFiles = hasFiles;
		embedder.checkModelPresence = async () => hasFiles();
		const previousInit = embedder.init.bind(embedder);
		embedder.init = async () => {
			const originalModelPath = env.localModelPath;
			const originalCacheDir = env.cacheDir;
			env.localModelPath = modelsDir;
			env.cacheDir = modelsDir;
			try {
				await previousInit();
			} finally {
				env.localModelPath = originalModelPath;
				env.cacheDir = originalCacheDir;
			}
		};
	}
	if (options.prefix) {
		const prefix = options.prefix;
		const previousEmbed = embedder.embed.bind(embedder);
		embedder.embed = (text: string) => previousEmbed(`${prefix}${text}`);
	}
	console.error(
		`[embedder-override] model=${embedder.modelName} dir=${modelsDir ?? "default"} prefix=${JSON.stringify(options.prefix ?? "")}`,
	);
}
