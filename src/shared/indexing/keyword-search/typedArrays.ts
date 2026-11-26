type GrowableArray = Int32Array | Uint16Array | Uint8Array;

export function grow<T extends GrowableArray>(
	array: T,
	minCapacity: number,
): T {
	if (array.length >= minCapacity) return array;
	const capacity = Math.max(minCapacity, array.length * 2);
	const next = new (array.constructor as new (length: number) => T)(capacity);
	next.set(array);
	return next;
}
