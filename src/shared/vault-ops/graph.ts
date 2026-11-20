import { pathKey } from "./ids.js";
import type { LinkGraph, LinkRef } from "./types.js";

function groupBy(
	refs: readonly LinkRef[],
	keyOf: (ref: LinkRef) => string | null,
): Map<string, LinkRef[]> {
	const groups = new Map<string, LinkRef[]>();
	for (const ref of refs) {
		const key = keyOf(ref);
		if (key === null) continue;
		const group = groups.get(key);
		if (group) group.push(ref);
		else groups.set(key, [ref]);
	}
	return groups;
}

export function createLinkGraph(refs: LinkRef[]): LinkGraph {
	const inboundByPath = groupBy(refs, (ref) =>
		ref.resolved === null ? null : pathKey(ref.resolved),
	);
	const outboundByPath = groupBy(refs, (ref) => pathKey(ref.from));
	return {
		refs,
		inbound: (path) => [...(inboundByPath.get(pathKey(path)) ?? [])],
		outbound: (path) => [...(outboundByPath.get(pathKey(path)) ?? [])],
	};
}
