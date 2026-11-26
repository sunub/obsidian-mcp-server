import { parentPort } from "node:worker_threads";
import { AutoTokenizer } from "@huggingface/transformers";
import { localEmbedder } from "@shared/local-ai/Embedder.js";
import type { ChunkMetadata } from "../VectorDB.js";
import {
	type ChunkingWorkerInput,
	createDocumentChunker,
} from "./chunkDocument.js";

export type { ChunkingWorkerInput } from "./chunkDocument.js";

export interface ChunkingWorkerOutput {
	success: boolean;
	records?: ChunkMetadata[];
	error?: string;
}

type DocumentChunker = ReturnType<typeof createDocumentChunker>;

let chunkerPromise: Promise<DocumentChunker> | null = null;

async function loadChunker(): Promise<DocumentChunker> {
	try {
		const tokenizer = await AutoTokenizer.from_pretrained(
			localEmbedder.modelName,
		);
		return createDocumentChunker((text) => tokenizer.encode(text).length);
	} catch {
		const { encodingForModel } = await import("js-tiktoken");
		const enc = encodingForModel("gpt-3.5-turbo");
		return createDocumentChunker((text) => enc.encode(text).length);
	}
}

parentPort?.on("message", async (data: ChunkingWorkerInput) => {
	try {
		chunkerPromise ??= loadChunker();
		const chunk = await chunkerPromise;
		const records = await chunk(data);
		const response: ChunkingWorkerOutput = { success: true, records };
		parentPort?.postMessage(response);
	} catch (error: unknown) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		const response: ChunkingWorkerOutput = { success: false, error: errorMsg };
		parentPort?.postMessage(response);
	}
});
