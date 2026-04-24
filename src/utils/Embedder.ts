import {
	env,
	type FeatureExtractionPipeline,
	pipeline,
} from "@huggingface/transformers";
import { MODELS_DIR } from "./constants.js";

class EmbedderService {
	private modelName = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
	private extractor: FeatureExtractionPipeline | null = null;
	private initPromise: Promise<void> | null = null;

	constructor() {
		env.allowRemoteModels = false;
		env.localModelPath = MODELS_DIR;
		env.cacheDir = MODELS_DIR;
	}

	public async checkModelPresence(): Promise<boolean> {
		try {
			await pipeline("feature-extraction", this.modelName, {
				local_files_only: true,
			});
			return true;
		} catch (_e) {
			return false;
		}
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

		if (!this.extractor) {
			throw new Error("Failed to initialize embedder");
		}

		const output = await this.extractor(text, {
			pooling: "mean",
			normalize: true,
		});

		return Array.from(output.data) as number[];
	}
}

export const localEmbedder = new EmbedderService();
