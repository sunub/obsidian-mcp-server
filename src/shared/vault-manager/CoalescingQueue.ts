export class CoalescingQueue {
	private pending = new Set<string>();
	private isDraining = false;

	constructor(private readonly run: (key: string) => Promise<void>) {}

	enqueue(key: string): void {
		this.pending.add(key);
		if (!this.isDraining) {
			void this.drain();
		}
	}

	cancel(key: string): void {
		this.pending.delete(key);
	}

	clear(): void {
		this.pending.clear();
	}

	private async drain(): Promise<void> {
		this.isDraining = true;
		try {
			for (const key of this.pending) {
				this.pending.delete(key);
				await this.run(key);
			}
		} finally {
			this.isDraining = false;
		}
	}
}
