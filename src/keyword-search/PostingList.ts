import { grow } from "./typedArrays.js";

const INITIAL_CAPACITY = 4;
const MAX_FREQUENCY = 0xffff;

export class PostingList {
	public ids = new Int32Array(INITIAL_CAPACITY);
	public frequencies = new Uint16Array(INITIAL_CAPACITY);
	public length = 0;
	public liveCount = 0;

	public append(chunkId: number, frequency: number): void {
		if (this.length === this.ids.length) {
			this.ids = grow(this.ids, this.length + 1);
			this.frequencies = grow(this.frequencies, this.length + 1);
		}
		this.ids[this.length] = chunkId;
		this.frequencies[this.length] = Math.min(frequency, MAX_FREQUENCY);
		this.length += 1;
		this.liveCount += 1;
	}

	public markRemoved(): void {
		this.liveCount -= 1;
	}

	public compact(remap: Int32Array): void {
		let kept = 0;
		for (let i = 0; i < this.length; i++) {
			const next = remap[this.ids[i] ?? 0] ?? -1;
			if (next < 0) continue;
			this.ids[kept] = next;
			this.frequencies[kept] = this.frequencies[i] ?? 0;
			kept += 1;
		}
		const capacity = Math.max(INITIAL_CAPACITY, kept);
		this.ids = this.ids.slice(0, capacity);
		this.frequencies = this.frequencies.slice(0, capacity);
		this.length = kept;
		this.liveCount = kept;
	}
}
