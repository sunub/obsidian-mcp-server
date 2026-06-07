import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ChunkMetadata } from "../VectorDB.js";
import type {
	ChunkingWorkerInput,
	ChunkingWorkerOutput,
} from "./chunkingWorker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface QueueItem {
	data: ChunkingWorkerInput;
	resolve: (value: ChunkMetadata[]) => void;
	reject: (reason: Error) => void;
}

export class WorkerPool {
	private workers: Worker[] = [];
	private freeWorkers: Worker[] = [];
	private queue: QueueItem[] = [];
	private poolSize: number;
	private workerPath: string;

	constructor(poolSize?: number) {
		this.poolSize = poolSize || Math.max(2, cpus().length - 1);
		this.workerPath = path.resolve(__dirname, "./chunkingWorker.js");
	}

	public init() {
		if (this.workers.length > 0) return;

		for (let i = 0; i < this.poolSize; i++) {
			const worker = new Worker(this.workerPath);
			this.workers.push(worker);
			this.freeWorkers.push(worker);
		}
	}

	public runTask(data: ChunkingWorkerInput): Promise<ChunkMetadata[]> {
		this.init();
		return new Promise<ChunkMetadata[]>((resolve, reject) => {
			this.queue.push({ data, resolve, reject });
			this.executeNext();
		});
	}

	private executeNext() {
		if (this.queue.length === 0 || this.freeWorkers.length === 0) {
			return;
		}

		const worker = this.freeWorkers.pop();
		if (!worker) {
			console.error("Unexpected error: No free worker available after check.");
			return;
		}

		const nextItem = this.queue.shift();
		if (!nextItem) {
			this.freeWorkers.push(worker);
			return;
		}

		const { data, resolve, reject } = nextItem;

		const messageHandler = (res: ChunkingWorkerOutput) => {
			cleanup();
			this.freeWorkers.push(worker);
			this.executeNext();

			if (res.success && res.records) {
				resolve(res.records);
			} else {
				reject(new Error(res.error || "Unknown worker error"));
			}
		};

		const errorHandler = (err: Error) => {
			cleanup();
			worker.terminate();
			const idx = this.workers.indexOf(worker);
			if (idx !== -1) this.workers.splice(idx, 1);

			const newWorker = new Worker(this.workerPath);
			this.workers.push(newWorker);
			this.freeWorkers.push(newWorker);

			this.executeNext();
			reject(err);
		};

		const cleanup = () => {
			worker.off("message", messageHandler);
			worker.off("error", errorHandler);
		};

		worker.on("message", messageHandler);
		worker.on("error", errorHandler);

		worker.postMessage(data);
	}

	public terminateAll() {
		for (const worker of this.workers) {
			worker.terminate();
		}
		this.workers = [];
		this.freeWorkers = [];
		this.queue = [];
	}
}

export const chunkingWorkerPool = new WorkerPool();
