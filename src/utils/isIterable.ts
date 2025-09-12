export function isIterable(obj: unknown): obj is Iterable<unknown> {
  return obj != null && typeof (obj as any)[Symbol.iterator] === 'function';
}
