import { env, pipeline } from "@huggingface/transformers";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { MODELS_DIR } from "./constants.js";

class EmbedderService {
	private modelName = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
	private extractor: any = null;
	private initPromise: Promise<void> | null = null;

	constructor() {
		env.allowRemoteModels = false;
		env.localModelPath = MODELS_DIR;
		env.cacheDir = MODELS_DIR;
	}

	public async checkModelPresence(): Promise<boolean> {
		const modelPath = join(
			MODELS_DIR,
			"Xenova/paraphrase-multilingual-MiniLM-L12-v2",
		);
		return existsSync(modelPath);
	}
	public async init(): Promise<void> {
		if (this.initPromise) return this.initPromise;

		this.initPromise = (async () => {
			this.extractor = await pipeline("feature-extraction", this.modelName);
		})();

		return this.initPromise;
	}

	public async embed(text: string): Promise<number[]> {
		if (!this.extractor) {
			await this.init();
		}

		const output = await this.extractor(text, {
			pooling: "mean",
			normalize: true,
		});

		return Array.from(output.data) as number[];
	}
}

export const localEmbedder = new EmbedderService();
