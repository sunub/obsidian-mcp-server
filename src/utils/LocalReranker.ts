import type {
	PreTrainedModel,
	PreTrainedTokenizer,
} from "@huggingface/transformers";
import {
	AutoModelForSequenceClassification,
	AutoTokenizer,
	env,
} from "@huggingface/transformers";
import { existsSync } from "node:fs";
import { join } from "node:path";
import z from "zod";
import { MODELS_DIR } from "./constants.js";

const rerankedResultsSchema = z.array(
	z.object({
		document: z.string(),
		score: z.number(),
	}),
);

export class Reranker {
	public readonly modelName = "Xenova/bge-reranker-base";
	private tokenizer: PreTrainedTokenizer | null = null;
	private model: PreTrainedModel | null = null;
	private initPromise: Promise<void> | null = null;

	constructor() {
		env.allowRemoteModels = false;
		env.localModelPath = MODELS_DIR;
		env.cacheDir = MODELS_DIR;
	}

	public async checkModelPresence(): Promise<boolean> {
		return this.hasLocalModelFiles();
	}

	public hasLocalModelFiles(): boolean {
		return existsSync(join(MODELS_DIR, this.modelName));
	}

	get isReady(): boolean {
		return this.tokenizer !== null && this.model !== null;
	}

	private async loadModel(): Promise<void> {
		if (!this.tokenizer) {
			this.tokenizer = await AutoTokenizer.from_pretrained(this.modelName);
		}
		if (!this.model) {
			this.model = await AutoModelForSequenceClassification.from_pretrained(
				this.modelName,
			);
		}
	}

	public async init(): Promise<void> {
		if (!this.initPromise) {
			this.initPromise = this.loadModel();
		}
		return this.initPromise;
	}

	public async dispose(): Promise<void> {
		if (this.model) {
			try {
				await this.model.dispose();
			} catch (e) {
				console.error("Failed to dispose reranker model:", e);
			}
		}
		this.tokenizer = null;
		this.model = null;
		this.initPromise = null;
	}

	public async rerank(
		query: string,
		documents: string[],
	): Promise<{ document: string; score: number }[]> {
		if (!this.isReady) {
			await this.init();
		}
		if (!this.tokenizer || !this.model) {
			throw new Error("Model or tokenizer failed to load.");
		}

		const queries = Array(documents.length).fill(query);
		const inputs = this.tokenizer(queries, {
			text_pair: documents,
			padding: true,
			truncation: true,
		});

		const { logits } = await this.model(inputs);
		const rawScores = Array.from(logits.data) as number[];

		const scores = rawScores.map((score) => 1 / (1 + Math.exp(-score)));
		const rankedDocuments = documents.map((doc, index) => ({
			document: doc,
			score: scores[index],
		}));

		const parsedResults = rerankedResultsSchema.parse(rankedDocuments) as {
			document: string;
			score: number;
		}[];

		return parsedResults.sort((a, b) => b.score - a.score);
	}
}

export const localReranker = new Reranker();
