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

type WorkerLike = Pick<Worker, "on" | "off" | "postMessage" | "terminate">;

interface QueueItem {
	data: ChunkingWorkerInput;
	resolve: (value: ChunkMetadata[]) => void;
	reject: (reason: Error) => void;
}

export class WorkerPool {
	private workers: WorkerLike[] = [];
	private freeWorkers: WorkerLike[] = [];
	private queue: QueueItem[] = [];
	private activeTasks = new Map<WorkerLike, QueueItem>();
	private poolSize: number;
	private workerPath: string;
	private createWorker: () => WorkerLike;

	constructor(poolSize?: number, createWorker?: () => WorkerLike) {
		this.poolSize = poolSize || Math.max(2, cpus().length - 1);
		this.workerPath = path.resolve(__dirname, "./chunkingWorker.js");
		this.createWorker = createWorker ?? (() => new Worker(this.workerPath));
	}

	public init() {
		if (this.workers.length > 0) return;

		for (let i = 0; i < this.poolSize; i++) {
			const worker = this.createWorker();
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
		this.activeTasks.set(worker, nextItem);

		const messageHandler = (res: ChunkingWorkerOutput) => {
			cleanup();
			this.activeTasks.delete(worker);
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
			this.activeTasks.delete(worker);
			void worker.terminate();
			const idx = this.workers.indexOf(worker);
			if (idx !== -1) this.workers.splice(idx, 1);

			const newWorker = this.createWorker();
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

	public async terminateAll(): Promise<void> {
		const error = new Error("Worker pool terminated");
		for (const item of this.queue) {
			item.reject(error);
		}
		for (const item of this.activeTasks.values()) {
			item.reject(error);
		}
		this.queue = [];
		this.activeTasks.clear();

		for (const worker of this.workers) {
			await worker.terminate();
		}
		this.workers = [];
		this.freeWorkers = [];
		this.activeTasks.clear();
	}
}

export const chunkingWorkerPool = new WorkerPool();
