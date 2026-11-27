import { computeBaselineRrfScores } from "./baseline.js";
import { normalizeScores } from "./convexCombination.js";
import type { AlgorithmContext, LinkGraph, SearchAlgorithm } from "./types.js";

export interface OneHopLinkBoostOptions {
	name: string;
	seedCount?: number;
	outWeight?: number;
	inWeight?: number;
}

export interface PprLinkBoostOptions {
	name: string;
	seedCount?: number;
	damping?: number;
	iterations?: number;
	blendWeight?: number;
}

function topEntries(
	scores: Map<string, number>,
	count: number,
): Array<[string, number]> {
	return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, count);
}

export function applyOneHopLinkBoost(
	baseScores: Map<string, number>,
	graph: LinkGraph,
	options: { seedCount: number; outWeight: number; inWeight: number },
): Map<string, number> {
	const boosted = new Map(baseScores);
	const seeds = topEntries(baseScores, options.seedCount);

	for (const [seedPath, seedScore] of seeds) {
		const outNeighbors = graph.outLinks.get(seedPath) ?? [];
		const outScale =
			outNeighbors.length > 0 ? 1 / Math.sqrt(outNeighbors.length) : 0;
		for (const neighbor of outNeighbors) {
			boosted.set(
				neighbor,
				(boosted.get(neighbor) ?? 0) + seedScore * options.outWeight * outScale,
			);
		}

		const inNeighbors = graph.inLinks.get(seedPath) ?? [];
		const inScale =
			inNeighbors.length > 0 ? 1 / Math.sqrt(inNeighbors.length) : 0;
		for (const neighbor of inNeighbors) {
			boosted.set(
				neighbor,
				(boosted.get(neighbor) ?? 0) + seedScore * options.inWeight * inScale,
			);
		}
	}

	return boosted;
}

function undirectedNeighbors(graph: LinkGraph, node: string): string[] {
	const set = new Set<string>();
	for (const target of graph.outLinks.get(node) ?? []) set.add(target);
	for (const source of graph.inLinks.get(node) ?? []) set.add(source);
	return [...set];
}

export function computePersonalizedPageRank(
	baseScores: Map<string, number>,
	graph: LinkGraph,
	options: { seedCount: number; damping: number; iterations: number },
): Map<string, number> {
	const seeds = topEntries(baseScores, options.seedCount);
	const seedSum = seeds.reduce((acc, [, score]) => acc + score, 0);
	if (seedSum <= 0) return new Map();

	const teleport = new Map<string, number>();
	for (const [relPath, score] of seeds) {
		teleport.set(relPath, score / seedSum);
	}

	let rank = new Map(teleport);

	for (let step = 0; step < options.iterations; step++) {
		const next = new Map<string, number>();
		for (const [node, prob] of teleport) {
			next.set(node, (1 - options.damping) * prob);
		}

		for (const [node, mass] of rank) {
			const neighbors = undirectedNeighbors(graph, node);
			if (neighbors.length === 0) {
				for (const [seedNode, prob] of teleport) {
					next.set(
						seedNode,
						(next.get(seedNode) ?? 0) + options.damping * mass * prob,
					);
				}
				continue;
			}
			const share = (options.damping * mass) / neighbors.length;
			for (const neighbor of neighbors) {
				next.set(neighbor, (next.get(neighbor) ?? 0) + share);
			}
		}

		rank = next;
	}

	return rank;
}

export function createOneHopLinkBoost(
	options: OneHopLinkBoostOptions,
): SearchAlgorithm {
	const seedCount = options.seedCount ?? 5;
	const outWeight = options.outWeight ?? 0.15;
	const inWeight = options.inWeight ?? 0.1;

	return {
		name: options.name,
		description: `RRF + 1-hop link boost (seeds=${seedCount}, out=${outWeight}, in=${inWeight})`,
		run(ctx: AlgorithmContext): string[] {
			const baseScores = computeBaselineRrfScores(ctx);
			const boosted = applyOneHopLinkBoost(baseScores, ctx.graph, {
				seedCount,
				outWeight,
				inWeight,
			});

			return [...boosted.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, ctx.limit)
				.map(([relPath]) => relPath);
		},
	};
}

export function createPprLinkBoost(
	options: PprLinkBoostOptions,
): SearchAlgorithm {
	const seedCount = options.seedCount ?? 10;
	const damping = options.damping ?? 0.3;
	const iterations = options.iterations ?? 10;
	const blendWeight = options.blendWeight ?? 0.15;

	return {
		name: options.name,
		description: `RRF + PPR (damping=${damping}, blend=${blendWeight})`,
		run(ctx: AlgorithmContext): string[] {
			const baseScores = computeBaselineRrfScores(ctx);
			const pprScores = computePersonalizedPageRank(baseScores, ctx.graph, {
				seedCount,
				damping,
				iterations,
			});

			const normBase = normalizeScores(baseScores);
			const normPpr = normalizeScores(pprScores);
			const allPaths = new Set([...normBase.keys(), ...normPpr.keys()]);
			const blended = new Map<string, number>();

			for (const relPath of allPaths) {
				const base = normBase.get(relPath) ?? 0;
				const ppr = normPpr.get(relPath) ?? 0;
				blended.set(relPath, (1 - blendWeight) * base + blendWeight * ppr);
			}

			return [...blended.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, ctx.limit)
				.map(([relPath]) => relPath);
		},
	};
}
