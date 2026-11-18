/**
 * 인덱싱 성능 측정 (docs/search-quality-evaluation.md 2.3 "인덱싱 지표").
 *
 * 측정 항목
 *   1. keyword  : 실제 Vault에서 DirectoryWalker + Indexer.build 시간, 처리량, 실패 건수
 *   2. synthetic: 실제 Vault 문서 내용으로 파일 N개를 "실제로" 만든 뒤 Indexer.build 처리량
 *   3. rag      : 빈 벡터 캐시에서 임베딩 인덱스 전체 생성 시간, 청크 수, 커버리지
 *
 * 사용법 (빌드 결과물을 사용하므로 먼저 `npx tsc && npx tsc-alias`)
 *   npx tsx scripts/eval/indexing-benchmark.ts --vault <복사본 Vault> [--synthetic 10000] [--rag] [--runs 5]
 *
 * --rag 는 <vault>/.obsidian/vector_cache 를 지우고 다시 만든다.
 * 실제 Vault를 보호하기 위해 --allow-reset 없이는 경로에 "scratch" 또는 "eval"이 들어간 Vault에서만 실행한다.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { mean, percentile } from "./lib/metrics.js";

const { values: args } = parseArgs({
	options: {
		vault: { type: "string" },
		synthetic: { type: "string" },
		"synthetic-dir": { type: "string" },
		rag: { type: "boolean", default: false },
		"allow-reset": { type: "boolean", default: false },
		runs: { type: "string", default: "5" },
		"strip-prefix": { type: "boolean", default: false },
		// 청킹 기준 비교: "<cl100k|model>:<size>:<overlap>:<recursive|heading>" (scripts/eval/lib/chunking-variants.ts)
		chunker: { type: "string" },
		out: { type: "string", default: "eval/indexing/results" },
	},
});

if (!args.vault) {
	console.error("--vault <path> 가 필요합니다.");
	process.exit(1);
}
const vaultPath = resolve(args.vault);
process.env["VAULT_DIR_PATH"] = vaultPath;
const runs = Number(args.runs);

const { DirectoryWalker } = await import(
	"../../build/utils/DirectoryWalker.js"
);
const { Indexer } = await import("../../build/utils/Indexer.js");
const { Semaphore } = await import("../../build/utils/semaphore.js");
// --strip-prefix: nomic 계열 규칙인 "search_query: " / "search_document: " 접두사를 떼고 임베딩한다.
// 현재 임베딩 모델(paraphrase-multilingual-MiniLM)은 이 접두사를 학습하지 않았으므로 효과를 비교하기 위한 실험 옵션이다.
// 소스 코드를 바꾸지 않고, 같은 프로세스의 localEmbedder.embed만 감싼다.
if (args["strip-prefix"]) {
	const { localEmbedder: embedder } = await import(
		"../../build/utils/Embedder.js"
	);
	const rawEmbed = embedder.embed.bind(embedder);
	embedder.embed = (text: string) =>
		rawEmbed(text.replace(/^search_(query|document): /, ""));
}

type Walked = { paths: string[]; walkMs: number };

async function walk(root: string): Promise<Walked> {
	const walker = new DirectoryWalker([".md", ".mdx"]);
	const t0 = performance.now();
	const paths: string[] = await walker.walk(root, new Semaphore(10));
	return { paths, walkMs: performance.now() - t0 };
}

async function totalBytes(paths: string[]): Promise<number> {
	let sum = 0;
	for (const p of paths) sum += (await stat(p)).size;
	return sum;
}

/** Indexer.build를 runs회 실행. 실패 건수 = 넘긴 경로 수 - 실제로 인덱싱된 문서 수 */
async function benchmarkKeywordBuild(paths: string[], bytes: number) {
	const buildMs: number[] = [];
	let indexed = 0;
	const originalError = console.error;
	let errorLogs = 0;
	console.error = () => {
		errorLogs++;
	};
	try {
		for (let i = 0; i < runs; i++) {
			const indexer = new Indexer();
			const t0 = performance.now();
			await indexer.build(paths, new Semaphore(10));
			buildMs.push(performance.now() - t0);
			indexed = indexer.getAllDocuments().length;
		}
	} finally {
		console.error = originalError;
	}
	const median = percentile(buildMs, 50);
	return {
		files: paths.length,
		indexed,
		failed: paths.length - indexed,
		errorLogsPerRun: errorLogs / runs,
		totalMB: bytes / 1024 / 1024,
		buildMs: {
			runs: buildMs.map((v) => Math.round(v)),
			median,
			p95: percentile(buildMs, 95),
			mean: mean(buildMs),
		},
		docsPerSec: indexed / (median / 1000),
		mbPerSec: bytes / 1024 / 1024 / (median / 1000),
	};
}

/** 실제 Vault 문서 내용을 순환하며 N개의 파일을 실제로 생성한다(내용 끝에 고유 토큰 추가). */
async function makeSyntheticVault(
	sources: string[],
	count: number,
	dir: string,
): Promise<string[]> {
	await rm(dir, { recursive: true, force: true });
	const contents = await Promise.all(sources.map((p) => readFile(p, "utf-8")));
	const paths: string[] = [];
	for (let i = 0; i < count; i++) {
		const filePath = join(dir, `bucket-${i % 50}`, `doc-${i}.md`);
		paths.push(filePath);
	}
	const sem = new Semaphore(64);
	await Promise.all(
		paths.map(async (filePath, i) => {
			await sem.acquire();
			try {
				await mkdir(dirname(filePath), { recursive: true });
				const source = contents[i % contents.length] as string;
				await writeFile(filePath, `${source}\n\nsynthetic-token-${i}\n`);
			} finally {
				sem.release();
			}
		}),
	);
	return paths;
}

/**
 * RAGIndexer가 워커 풀에 맡기던 청킹을 실험용 청커로 바꾼다. 청킹은 같은 프로세스에서 돌므로
 * 비교할 때는 기준 구성도 --chunker cl100k:500:50:recursive 로 같은 경로에서 측정한다.
 */
async function applyVariantChunker(spec: string) {
	const { parseVariant, createVariantChunker } = await import(
		"./lib/chunking-variants.js"
	);
	const { ragIndexer } = await import("../../build/utils/RAGIndexer.js");
	const { parse } = await import("../../build/utils/processor/MatterParser.js");
	const { stripEmbeddedData } = await import(
		"../../build/utils/processor/stripEmbeddedData.js"
	);
	const { localEmbedder } = await import("../../build/utils/Embedder.js");
	const { AutoTokenizer } = await import("@huggingface/transformers");
	const tokenizer = await AutoTokenizer.from_pretrained(
		localEmbedder.modelName,
	);
	const variant = parseVariant(spec);
	const chunk = await createVariantChunker(variant, {
		parseMatter: parse,
		stripEmbeddedData,
		countModelTokens: (text: string) => tokenizer.encode(text).length,
	});
	(
		ragIndexer as unknown as { chukingWorkerPool: { runTask: typeof chunk } }
	).chukingWorkerPool.runTask = chunk;
	console.error(`[chunker] ${JSON.stringify(variant)}`);
}

async function benchmarkRag() {
	const safe = args["allow-reset"] || /scratch|eval/i.test(vaultPath);
	if (!safe) {
		throw new Error(
			`--rag 는 벡터 캐시를 지웁니다. 복사본 Vault가 아니라면 실행하지 마세요: ${vaultPath}`,
		);
	}
	const cacheDir = join(vaultPath, ".obsidian", "vector_cache");
	await rm(cacheDir, { recursive: true, force: true });

	const { VaultManager } = await import(
		"../../build/utils/VaultManger/VaultManager.js"
	);
	const { vectorDB } = await import("../../build/utils/VectorDB.js");
	const { localModelManager } = await import(
		"../../build/utils/LocalModelManager.js"
	);

	if (args.chunker) {
		await applyVariantChunker(args.chunker);
	}

	const vm = new VaultManager(vaultPath);
	await vm.initialize();
	const docs = await vm.getAllDocuments();

	const passes: {
		pass: number;
		ms: number;
		filesInIndex: number;
		chunks: number;
	}[] = [];
	// 1회차: 빈 캐시에서 전체 생성. 모델 준비가 늦으면 건너뛴 파일이 생길 수 있으므로
	// 커버리지가 100%가 될 때까지(최대 3회) 다시 동기화하며 각 회차를 기록한다.
	for (let pass = 1; pass <= 3; pass++) {
		const t0 = performance.now();
		await vm.syncMissingRagIndices();
		const ms = performance.now() - t0;
		const table = await vectorDB.getTable();
		const rows = table
			? ((await table.query().select(["filePath"]).toArray()) as {
					filePath: string;
				}[])
			: [];
		const filesInIndex = new Set(rows.map((r) => r.filePath)).size;
		passes.push({ pass, ms, filesInIndex, chunks: rows.length });
		console.error(
			`[rag] pass ${pass}: ${(ms / 1000).toFixed(1)}s, files ${filesInIndex}/${docs.length}, chunks ${rows.length}`,
		);
		if (filesInIndex >= docs.length) break;
	}

	const table = await vectorDB.getTable();
	const indices = table ? await table.listIndices() : [];
	await localModelManager.shutdown();

	const first = passes[0] as (typeof passes)[number];
	const last = passes[passes.length - 1] as (typeof passes)[number];
	return {
		documents: docs.length,
		passes,
		firstPass: {
			seconds: first.ms / 1000,
			coverage: first.filesInIndex / docs.length,
			chunks: first.chunks,
			chunksPerSec: first.chunks / (first.ms / 1000),
		},
		final: {
			filesInIndex: last.filesInIndex,
			coverage: last.filesInIndex / docs.length,
			chunks: last.chunks,
			totalSeconds: passes.reduce((a, p) => a + p.ms, 0) / 1000,
		},
		// 청크가 0개인 문서(빈 문서 등)는 인덱스에 없어도 정상이다.
		vectorIndexes: indices.map((i: { name: string; indexType: string }) => ({
			name: i.name,
			type: i.indexType,
		})),
	};
}

const environment = {
	date: new Date().toISOString(),
	node: process.version,
	platform: `${process.platform}-${process.arch}`,
	cpu: cpus()[0]?.model,
	cores: cpus().length,
	memoryGB: Math.round(totalmem() / 1024 ** 3),
	vault: relative(process.cwd(), vaultPath),
	stripPrefix: Boolean(args["strip-prefix"]),
	chunker: args.chunker ?? "worker (src/utils/worker/chunkingWorker.ts)",
};

const result: Record<string, unknown> = { environment };

const { paths, walkMs } = await walk(vaultPath);
const bytes = await totalBytes(paths);
result["keyword"] = { walkMs, ...(await benchmarkKeywordBuild(paths, bytes)) };
console.error("[keyword]", JSON.stringify(result["keyword"]));

if (args.synthetic) {
	const count = Number(args.synthetic);
	const dir = resolve(
		args["synthetic-dir"] ?? join(dirname(vaultPath), `synthetic-${count}`),
	);
	const synthPaths = await makeSyntheticVault(paths, count, dir);
	const synthBytes = await totalBytes(synthPaths);
	result["synthetic"] = {
		dir: relative(process.cwd(), dir),
		...(await benchmarkKeywordBuild(synthPaths, synthBytes)),
	};
	console.error("[synthetic]", JSON.stringify(result["synthetic"]));
	await rm(dir, { recursive: true, force: true });
}

if (args.rag) {
	result["rag"] = await benchmarkRag();
}

await mkdir(args.out as string, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = join(args.out as string, `indexing-${stamp}.json`);
await writeFile(outFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
console.error(`\n결과 저장: ${outFile}`);
if (!existsSync(outFile)) process.exit(1);
process.exit(0);
