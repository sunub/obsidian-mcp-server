import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { algorithms } from "./algorithms/index.js";
import type {
	AlgorithmContext,
	DenseCandidate,
	EvalDocument,
	KeywordCandidate,
} from "./algorithms/types.js";
import { buildLinkGraph } from "./compare-algorithms.js";
import {
	type GoldenQuery,
	mergeGradesIntoQuery,
	type RelevanceGrade,
	readGoldenSet,
	writeGoldenSet,
} from "./lib/goldenSet.js";

export interface UnjudgedCandidate {
	id: string;
	type: string;
	query: string;
	path: string;
	systems: string[];
	bestRank: number;
	snippet: string;
}

export interface JudgmentRecord {
	id: string;
	path: string;
	grade: RelevanceGrade;
}

export function collectUnjudgedCandidates(
	queries: GoldenQuery[],
	rankingsBySystem: Map<string, Map<string, string[]>>,
	topK: number,
): Array<{
	id: string;
	type: string;
	query: string;
	path: string;
	systems: string[];
	bestRank: number;
}> {
	const results: Array<{
		id: string;
		type: string;
		query: string;
		path: string;
		systems: string[];
		bestRank: number;
	}> = [];

	for (const item of queries) {
		const unjudged = new Map<
			string,
			{ systems: Set<string>; bestRank: number }
		>();

		for (const [systemName, byQuery] of rankingsBySystem) {
			const ranked = (byQuery.get(item.query) ?? []).slice(0, topK);
			ranked.forEach((docPath, index) => {
				if (Object.hasOwn(item.grades, docPath)) return;
				const rank = index + 1;
				const prev = unjudged.get(docPath);
				if (prev) {
					prev.systems.add(systemName);
					prev.bestRank = Math.min(prev.bestRank, rank);
				} else {
					unjudged.set(docPath, {
						systems: new Set([systemName]),
						bestRank: rank,
					});
				}
			});
		}

		const sorted = [...unjudged.entries()].sort(
			(a, b) =>
				a[1].bestRank - b[1].bestRank ||
				b[1].systems.size - a[1].systems.size ||
				a[0].localeCompare(b[0]),
		);

		for (const [docPath, meta] of sorted) {
			results.push({
				id: item.id,
				type: item.type,
				query: item.query,
				path: docPath,
				systems: [...meta.systems].sort(),
				bestRank: meta.bestRank,
			});
		}
	}

	return results;
}

export function applyJudgmentRecords(
	queries: GoldenQuery[],
	records: JudgmentRecord[],
): { updated: GoldenQuery[]; appliedCount: number } {
	const byId = new Map<string, Record<string, RelevanceGrade>>();
	for (const rec of records) {
		const map = byId.get(rec.id) ?? {};
		map[rec.path] = rec.grade;
		byId.set(rec.id, map);
	}

	let appliedCount = 0;
	const updated = queries.map((query) => {
		const updates = byId.get(query.id);
		if (!updates) return query;
		appliedCount += Object.keys(updates).length;
		return mergeGradesIntoQuery(query, updates);
	});

	return { updated, appliedCount };
}

function renderReviewMarkdown(candidates: UnjudgedCandidate[]): string {
	const lines: string[] = [
		"# 미채점 상위 후보 검수 목록",
		"",
		"- **2**: 질의가 찾는 핵심 내용을 실질적으로 다룸",
		"- **1**: 부분 관련 또는 인접 주제",
		"- **0**: 무관",
		"",
		`총 ${candidates.length}쌍`,
		"",
	];

	candidates.forEach((c, idx) => {
		lines.push(`### ${idx + 1}. [${c.id} | ${c.type}] ${c.query}`);
		lines.push(
			`- 문서: \`${c.path}\` (최고 순위: ${c.bestRank}, 출처: ${c.systems.join(", ")})`,
		);
		lines.push(`- 발췌: ${c.snippet}`);
		lines.push("");
	});

	return lines.join("\n");
}

async function runApply(queriesPath: string, applyPath: string): Promise<void> {
	const queries = await readGoldenSet(queriesPath);
	const raw = await readFile(applyPath, "utf-8");
	const records = raw
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as JudgmentRecord);

	const { updated, appliedCount } = applyJudgmentRecords(queries, records);
	await writeGoldenSet(queriesPath, updated);
	console.log(`Applied ${appliedCount} judgments to ${queriesPath}`);
}

async function main() {
	const { values } = parseArgs({
		options: {
			vault: { type: "string" },
			queries: {
				type: "string",
				default: "eval/search/queries-blind-labeled.jsonl",
			},
			only: { type: "string", default: "baseline_rrf,dense_only,cc_a0.5" },
			top: { type: "string", default: "5" },
			out: { type: "string", default: "/tmp/unjudged-pool.jsonl" },
			"review-md": { type: "string" },
			apply: { type: "string" },
		},
	});

	const queriesPath = values.queries as string;
	if (values.apply) {
		await runApply(queriesPath, values.apply as string);
		return;
	}

	const rawVault = values.vault ?? process.env["VAULT_DIR_PATH"];
	if (!rawVault) {
		console.error(
			"Usage: npx tsx scripts/eval/extract-unjudged.ts --vault <path> --queries <jsonl> [--only a,b] [--top 5] [--out <jsonl>] [--review-md <md>]",
		);
		process.exit(1);
	}

	const vaultPath = resolve(rawVault);
	process.env["VAULT_DIR_PATH"] = vaultPath;
	const topK = Number(values.top);

	const { Indexer } = await import("../../build/shared/indexing/Indexer.js");
	const { DirectoryWalker } = await import(
		"../../build/shared/indexing/DirectoryWalker.js"
	);
	const { Semaphore } = await import("../../build/shared/async/semaphore.js");
	const { localEmbedder } = await import(
		"../../build/shared/local-ai/Embedder.js"
	);
	const { vectorDB } = await import("../../build/shared/indexing/VectorDB.js");
	const { localModelManager } = await import(
		"../../build/shared/local-ai/LocalModelManager.js"
	);
	const MatterParser = await import(
		"../../build/shared/markdown/MatterParser.js"
	);

	const toRel = (p: string) => relative(vaultPath, p);
	const walker = new DirectoryWalker([".md", ".mdx"]);
	const sem = new Semaphore(10);
	const filePaths = await walker.walk(vaultPath, sem);
	const indexer = new Indexer();
	await indexer.build(filePaths, sem);

	const documents: EvalDocument[] = await Promise.all(
		filePaths.map(async (filePath) => {
			const [raw, fileStat] = await Promise.all([
				readFile(filePath, "utf-8"),
				stat(filePath),
			]);
			const { frontmatter, content } = MatterParser.parse(
				filePath,
				fileStat.birthtime.toISOString(),
				raw,
			);
			return {
				relPath: toRel(filePath),
				title: frontmatter.title ?? "",
				tags: frontmatter.tags ?? [],
				body: content,
			};
		}),
	);

	const graph = buildLinkGraph(
		indexer.getAllDocuments().map((doc) => ({
			relPath: toRel(doc.filePath),
			documentLinks: doc.documentLinks,
		})),
	);

	await localEmbedder.init();

	const wanted = new Set((values.only as string).split(","));
	const selected = algorithms.filter((a) => wanted.has(a.name));
	const queries = await readGoldenSet(queriesPath);

	const searchVector = async (
		vector: number[],
		limit: number,
	): Promise<DenseCandidate[]> => {
		const raw = await vectorDB.search(vector, limit);
		return raw
			.filter((c) => indexer.getDocument(c.filePath) !== null)
			.map((c) => ({
				relPath: toRel(c.filePath),
				distance: c._distance,
				similarity: Math.max(0, 1 - c._distance),
				chunkContent: c.content,
			}));
	};

	const searchKeyword = (
		query: string,
		minRelativeScore = 0,
	): KeywordCandidate[] =>
		indexer.searchWithChunks(query, minRelativeScore).map((h) => ({
			relPath: toRel(h.document.filePath),
			score: h.score,
		}));

	const rankingsBySystem = new Map<string, Map<string, string[]>>();
	for (const alg of selected) {
		rankingsBySystem.set(alg.name, new Map());
	}

	for (const item of queries) {
		const qVec = await localEmbedder.embed(item.query);
		const denseHits = await searchVector(qVec, 50);
		const keywordHits = searchKeyword(item.query, 0);
		const ctx: AlgorithmContext = {
			query: item.query,
			limit: Math.max(10, topK),
			keywordHits,
			denseHits,
			graph,
			documents,
			vaultPath,
			embed: (text) => localEmbedder.embed(text),
			searchVector,
			searchKeyword,
		};
		for (const alg of selected) {
			const ranked = await alg.run(ctx);
			rankingsBySystem.get(alg.name)?.set(item.query, ranked);
		}
	}

	const rawCandidates = collectUnjudgedCandidates(
		queries,
		rankingsBySystem,
		topK,
	);
	const snippetCache = new Map<string, string>();
	const candidates: UnjudgedCandidate[] = [];

	for (const cand of rawCandidates) {
		let snippet = snippetCache.get(cand.path);
		if (snippet === undefined) {
			const abs = join(vaultPath, cand.path);
			if (existsSync(abs)) {
				const rawText = await readFile(abs, "utf-8");
				snippet = rawText
					.replace(/^---[\s\S]*?---\s*/, "")
					.replace(/\s+/g, " ")
					.slice(0, 320);
			} else {
				snippet = "";
			}
			snippetCache.set(cand.path, snippet);
		}
		candidates.push({ ...cand, snippet });
	}

	const outPath = resolve(values.out as string);
	await mkdir(dirname(outPath), { recursive: true });
	await writeFile(
		outPath,
		`${candidates.map((c) => JSON.stringify(c)).join("\n")}\n`,
		"utf-8",
	);

	if (values["review-md"]) {
		const mdPath = resolve(values["review-md"] as string);
		await mkdir(dirname(mdPath), { recursive: true });
		await writeFile(mdPath, renderReviewMarkdown(candidates), "utf-8");
		console.log(`Review markdown written: ${mdPath}`);
	}

	console.log(
		`Extracted ${candidates.length} unjudged pairs (top-${topK}, systems=${selected.map((s) => s.name).join(",")}) -> ${outPath}`,
	);
	await localModelManager.shutdown();
	process.exit(0);
}

const isEntry = process.argv[1]?.endsWith("extract-unjudged.ts");
if (isEntry) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
