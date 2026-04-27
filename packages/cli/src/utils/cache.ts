export interface CacheEntry<V> {
	value: V;
	timestamp: number;
	ttl?: number;
}

export interface CacheOptions {
	defaultTTL?: number;
	deleteOnPromiseFailure?: boolean;
}

export class CacheService<K extends object | string | undefined, V> {
	private readonly storage: Map<K, CacheEntry<V>>;
	private readonly defaultTTL?: number;
	private readonly deleteOnPromiseFailure: boolean;

	constructor(options: CacheOptions = {}) {
		this.storage = new Map<K, CacheEntry<V>>();
		this.defaultTTL = options.defaultTTL;
		this.deleteOnPromiseFailure = options.deleteOnPromiseFailure ?? false;
	}

	get(key: K): V | undefined {
		const entry = this.storage.get(key) as CacheEntry<V> | undefined;
		if (!entry) {
			return undefined;
		}

		const ttl = entry.ttl ?? this.defaultTTL;
		if (ttl !== undefined && Date.now() - entry.timestamp > ttl) {
			this.delete(key);
		}

		return entry.value;
	}

	set(key: K, value: V, ttl?: number) {
		const entry: CacheEntry<V> = {
			value,
			timestamp: Date.now(),
			ttl,
		};

		this.storage.set(key, entry);

		if (this.deleteOnPromiseFailure && value instanceof Promise) {
			value.catch(() => {
				if (this.storage.get(key) === entry) {
					this.delete(key);
				}
			});
		}
	}

	getOrCreate(key: K, creator: () => V, ttl?: number): V {
		let value = this.get(key);
		if (value === undefined) {
			value = creator();
			this.set(key, value, ttl);
		}
		return value;
	}

	delete(key: K) {
		if (this.storage instanceof Map) {
			this.storage.delete(key);
		} else {
			(this.storage as WeakMap<WeakKey, CacheEntry<V>>).delete(key as WeakKey);
		}
	}
}

export function createCache<K extends string | undefined, V>(
	options: CacheOptions,
): CacheService<K, V>;
export function createCache<K extends object, V>(
	options?: CacheOptions,
): CacheService<K, V>;
export function createCache<K extends object | string | undefined, V>(
	options: CacheOptions = {},
): CacheService<K, V> {
	return new CacheService<K, V>(options);
}
