/**
 * "1차 검출(키워드 + 벡터 RRF) → AI 재판정(로컬 리랭커)" 구조의 검색 품질 평가 스크립트.
 *
 * - 데이터: KLUE-MRC v1.1 dev (CC BY-SA 4.0). 질문 → 질문이 만들어진 문단을 검색 정답으로 사용한다.
 *   question_type 1(패러프레이즈), 2(다중 문장 추론)만 사용하고 답이 없는 질문(type 3)은 제외한다.
 * - 각 문단을 Obsidian 노트(.md) 하나로 만든 임시 Vault를 생성하고, 실제 서버 코드(build/)로 검색한다.
 * - 측정 단계
 *   1. keyword      : 키워드 인덱스 단독 (= 로컬 모델이 없을 때 서버가 반환하는 폴백 결과)
 *   2. semantic     : 벡터 검색 단독, 재판정 없음
 *   3. hybrid_rrf   : 키워드 + 벡터 RRF 융합까지만 (리랭커를 순서 보존 함수로 대체)
 *   4. hybrid_prod  : 실제 서버 경로 그대로 (RRF + 조건부 리랭킹)
 *
 * 사용법 (저장소 루트에서):
 *   npm run build
 *   npx @sunub/obsidian-mcp-server setup   # 로컬 모델 설치 (없으면 keyword 단계만 측정)
 *   npx tsx scripts/eval_retrieval.ts [--sample 200] [--seed 42] [--corpus 0] [--out .eval-cache/retrieval]
 *
 *   --sample N  : question_type별 표본 수 (0이면 전체)
 *   --corpus N  : 문서 수 상한 (0이면 dev 전체 문단). 정답 문단은 항상 포함된다.
 *   --smoke     : 모델 대신 장난감 구현으로 코드 경로만 점검한다. 이 모드의 수치는 결과로 쓰면 안 된다.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const DATA_URL =
	"https://raw.githubusercontent.com/KLUE-benchmark/KLUE/main/klue_benchmark/klue-mrc-v1.1/klue-mrc-v1.1_dev.json";
const TOP_K = 10;
const STAGES = ["keyword", "semantic", "hybrid_rrf", "hybrid_prod"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_LABEL: Record<Stage, string> = {
	keyword: "키워드 단독 (AI 불가 시 폴백)",
	semantic: "벡터 단독 (재판정 없음)",
	hybrid_rrf: "1차 검출: 키워드+벡터 RRF",
	hybrid_prod: "1차 검출 + AI 재판정 (실제 서버 경로)",
};

interface Args {
	data: string;
	out: string;
	sample: number;
	seed: number;
	corpus: number;
	smoke: boolean;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		data: ".eval-cache/klue-mrc-v1.1_dev.json",
		out: ".eval-cache/retrieval",
		sample: 200,
		seed: 42,
		corpus: 0,
		smoke: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const key = argv[i];
		const value = argv[i + 1];
		if (key === "--smoke") {
			args.smoke = true;
		} else if (key === "--data" && value) {
			args.data = value;
			i++;
		} else if (key === "--out" && value) {
			args.out = value;
			i++;
		} else if (key === "--sample" && value) {
			args.sample = Number.parseInt(value, 10);
			i++;
		} else if (key === "--seed" && value) {
			args.seed = Number.parseInt(value, 10);
			i++;
		} else if (key === "--corpus" && value) {
			args.corpus = Number.parseInt(value, 10);
			i++;
		}
	}
	return args;
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffle<T>(items: T[], rand: () => number): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
	}
	return copy;
}

// Indexer가 본문을 토큰화할 때 쓰는 규칙과 동일하다.
function contentTokens(text: string): Set<string> {
	return new Set(text.toLowerCase().match(/[a-z0-9가-힣]+/g) ?? []);
}

interface Doc {
	id: string;
	title: string;
	context: string;
}

interface Query {
	guid: string;
	question: string;
	type: 1 | 2;
	goldId: string;
	overlap: number;
}

interface KlueMrc {
	data: Array<{
		title: string;
		paragraphs: Array<{
			context: string;
			qas: Array<{
				question: string;
				question_type: number;
				is_impossible: boolean;
				guid: string;
			}>;
		}>;
	}>;
}

async function loadDataset(path: string): Promise<KlueMrc> {
	if (!existsSync(path)) {
		console.log(`데이터셋 다운로드: ${DATA_URL}`);
		const res = await fetch(DATA_URL);
		if (!res.ok) {
			throw new Error(`데이터셋 다운로드 실패: HTTP ${res.status}`);
		}
		await mkdir(resolve(path, ".."), { recursive: true });
		await writeFile(path, await res.text(), "utf8");
	}
	return JSON.parse(await readFile(path, "utf8")) as KlueMrc;
}

function buildEvalSet(
	dataset: KlueMrc,
	args: Args,
): { docs: Doc[]; queries: Query[] } {
	const allDocs: Doc[] = [];
	const candidates: Query[] = [];
	dataset.data.forEach((article, a) => {
		article.paragraphs.forEach((paragraph, p) => {
			const id = `klue_${a}_${p}`;
			allDocs.push({ id, title: article.title, context: paragraph.context });
			const passageTokens = contentTokens(paragraph.context);
			for (const qa of paragraph.qas) {
				if (qa.is_impossible) continue;
				if (qa.question_type !== 1 && qa.question_type !== 2) continue;
				const qTokens = [...contentTokens(qa.question)];
				const hits = qTokens.filter((t) => passageTokens.has(t)).length;
				candidates.push({
					guid: qa.guid,
					question: qa.question,
					type: qa.question_type,
					goldId: id,
					overlap: qTokens.length > 0 ? hits / qTokens.length : 0,
				});
			}
		});
	});

	const rand = mulberry32(args.seed);
	const queries: Query[] = [];
	for (const type of [1, 2] as const) {
		const ofType = shuffle(
			candidates.filter((q) => q.type === type),
			rand,
		);
		queries.push(...(args.sample > 0 ? ofType.slice(0, args.sample) : ofType));
	}

	if (args.corpus <= 0 || args.corpus >= allDocs.length) {
		return { docs: allDocs, queries };
	}
	const goldIds = new Set(queries.map((q) => q.goldId));
	const distractors = shuffle(
		allDocs.filter((d) => !goldIds.has(d.id)),
		rand,
	).slice(0, Math.max(0, args.corpus - goldIds.size));
	return {
		docs: [...allDocs.filter((d) => goldIds.has(d.id)), ...distractors],
		queries,
	};
}

async function writeVault(vaultDir: string, docs: Doc[]): Promise<void> {
	await rm(vaultDir, { recursive: true, force: true });
	await mkdir(vaultDir, { recursive: true });
	for (const doc of docs) {
		const body = `---\ntitle: ${JSON.stringify(doc.title)}\n---\n\n${doc.context}\n`;
		await writeFile(join(vaultDir, `${doc.id}.md`), body, "utf8");
	}
}

function docIdOf(filePath: string): string {
	return basename(filePath).replace(/\.mdx?$/i, "");
}

function uniqueTopK(ids: string[]): string[] {
	return [...new Set(ids)].slice(0, TOP_K);
}

function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.min(
		sorted.length - 1,
		Math.ceil((p / 100) * sorted.length) - 1,
	);
	return sorted[Math.max(0, idx)] as number;
}

interface StageRun {
	ranked: string[];
	ms: number;
	rerankCalls?: { site: "semantic" | "hybrid"; docs: number; ms: number }[];
	// 벡터 검색 1위 청크의 코사인 거리 (재판정 생략 기준 0.2와 비교용)
	topDistance?: number;
}

interface Row {
	query: Query;
	stages: Partial<Record<Stage, StageRun>>;
}

function rankOf(run: StageRun | undefined, goldId: string): number {
	if (!run) return -1;
	return run.ranked.indexOf(goldId);
}

function summarize(rows: Row[], stage: Stage) {
	const ranks = rows.map((r) => rankOf(r.stages[stage], r.query.goldId));
	const n = ranks.length;
	const hit = (k: number) => ranks.filter((r) => r >= 0 && r < k).length / n;
	const mrr =
		ranks.reduce((sum, r) => sum + (r >= 0 && r < TOP_K ? 1 / (r + 1) : 0), 0) /
		n;
	const ms = rows
		.map((r) => r.stages[stage]?.ms)
		.filter((v): v is number => typeof v === "number");
	return {
		n,
		hit1: hit(1),
		hit5: hit(5),
		hit10: hit(10),
		miss10: 1 - hit(10),
		mrr10: mrr,
		msMean: ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length),
		msP95: percentile(ms, 95),
	};
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function installSmokeModels(
	localEmbedder: Record<string, unknown>,
	localReranker: Record<string, unknown>,
): void {
	// 모델 없이 코드 경로만 점검하기 위한 장난감 구현. 이 모드의 수치는 품질 지표가 아니다.
	const dim = 384;
	const hashVec = (text: string): number[] => {
		const vec = new Array<number>(dim).fill(0);
		const s = text.toLowerCase().replace(/\s+/g, " ");
		for (let i = 0; i < s.length - 1; i++) {
			let h = 2166136261;
			for (const ch of s.slice(i, i + 2)) {
				h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
			}
			vec[(h >>> 0) % dim] = (vec[(h >>> 0) % dim] ?? 0) + 1;
		}
		const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
		return vec.map((v) => v / norm);
	};
	const noop = async () => {};
	Object.assign(localEmbedder, {
		checkModelPresence: async () => true,
		hasLocalModelFiles: () => true,
		init: noop,
		dispose: noop,
		getTokenCount: (text: string) => Math.ceil(text.length / 4),
		embed: async (text: string) => hashVec(text),
	});
	Object.assign(localReranker, {
		checkModelPresence: async () => true,
		init: noop,
		dispose: noop,
		rerank: async (query: string, documents: string[]) => {
			const q = contentTokens(query);
			return documents
				.map((document) => {
					const d = contentTokens(document);
					const score = [...q].filter((t) => d.has(t)).length / (q.size || 1);
					return { document, score };
				})
				.sort((a, b) => b.score - a.score);
		},
	});
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const root = process.cwd();
	if (!existsSync(join(root, "build/utils/VaultManger/VaultManager.js"))) {
		throw new Error("build/ 가 없습니다. 먼저 `npm run build`를 실행하세요.");
	}

	const outDir = resolve(root, args.out);
	const vaultDir = join(outDir, "vault");
	const dataset = await loadDataset(resolve(root, args.data));
	const { docs, queries } = buildEvalSet(dataset, args);
	await writeVault(vaultDir, docs);

	// config.ts가 import 시점에 환경 변수를 읽으므로 서버 모듈은 반드시 이 뒤에 불러온다.
	process.env["VAULT_DIR_PATH"] = vaultDir;
	const buildUrl = (p: string) =>
		new URL(`../build/${p}`, import.meta.url).href;
	const { VaultManager } = await import(
		buildUrl("utils/VaultManger/VaultManager.js")
	);
	const { localEmbedder } = await import(buildUrl("utils/Embedder.js"));
	const { localReranker } = await import(buildUrl("utils/LocalReranker.js"));
	const { localModelManager } = await import(
		buildUrl("utils/LocalModelManager.js")
	);
	const { vectorDB } = await import(buildUrl("utils/VectorDB.js"));

	if (args.smoke) {
		installSmokeModels(localEmbedder, localReranker);
	}

	const modelsReady =
		(await localEmbedder.checkModelPresence()) &&
		(await localReranker.checkModelPresence());
	const stages: Stage[] = modelsReady ? [...STAGES] : ["keyword"];

	console.log(
		`문서 ${docs.length}개, 질의 ${queries.length}개 (type1 ${queries.filter((q) => q.type === 1).length} / type2 ${queries.filter((q) => q.type === 2).length}), seed=${args.seed}`,
	);
	if (!modelsReady) {
		console.log(
			"로컬 모델이 없어 keyword 단계만 측정합니다. `npx @sunub/obsidian-mcp-server setup` 후 다시 실행하세요.",
		);
	}

	const vm = new VaultManager(vaultDir, 20);
	await vm.initialize();
	// biome-ignore lint/suspicious/noExplicitAny: 평가를 위해 내부 키워드 인덱스에 직접 접근한다.
	const indexer = (vm as any).indexer;

	if (modelsReady) {
		// 모델을 미리 올려 두어 3초 soft deadline 때문에 측정 중 폴백이 일어나지 않게 한다.
		await localEmbedder.init();
		await localReranker.init();
		const t0 = performance.now();
		console.log("벡터 인덱스 생성 중 (실제 RAGIndexer 경로)...");
		await vm.syncMissingRagIndices();
		console.log(
			`벡터 인덱스 생성 완료: ${((performance.now() - t0) / 1000).toFixed(1)}s`,
		);
	}

	const realRerank = localReranker.rerank.bind(localReranker);
	let rerankLog: NonNullable<StageRun["rerankCalls"]> = [];
	const passThroughRerank = async (_query: string, documents: string[]) =>
		documents.map((document, i) => ({
			document,
			score: 1 - i / (documents.length + 1),
		}));
	const loggingRerank = async (query: string, documents: string[]) => {
		const site = (new Error().stack ?? "").includes("safeSemanticSearch")
			? "semantic"
			: "hybrid";
		const t = performance.now();
		const result = await realRerank(query, documents);
		rerankLog.push({ site, docs: documents.length, ms: performance.now() - t });
		return result;
	};

	const rows: Row[] = queries.map((query) => ({ query, stages: {} }));
	for (const stage of stages) {
		const t0 = performance.now();
		for (const row of rows) {
			const q = row.query.question;
			const t = performance.now();
			let ranked: string[] = [];
			let topDistance: number | undefined;
			rerankLog = [];
			if (stage === "keyword") {
				ranked = indexer
					.search(q)
					.slice(0, TOP_K)
					.map((d: { filePath: string }) => docIdOf(d.filePath));
			} else if (stage === "semantic") {
				// hybridSearch(q, 10) → safeSemanticSearch(q, 30) → 청크 90개 검색과 같은 조건
				const vec = await localEmbedder.embed(`search_query: ${q}`);
				const hits = await vectorDB.search(vec, TOP_K * 9);
				topDistance = hits[0]?._distance;
				ranked = uniqueTopK(
					hits.map((h: { filePath: string }) => docIdOf(h.filePath)),
				);
			} else {
				localReranker.rerank =
					stage === "hybrid_rrf" ? passThroughRerank : loggingRerank;
				const { results } = await vm.hybridSearch(q, TOP_K);
				ranked = uniqueTopK(
					results.map((r: { document: { filePath: string } }) =>
						docIdOf(r.document.filePath),
					),
				);
			}
			row.stages[stage] = {
				ranked,
				ms: performance.now() - t,
				...(stage === "hybrid_prod" ? { rerankCalls: rerankLog } : {}),
				...(topDistance !== undefined ? { topDistance } : {}),
			};
		}
		localReranker.rerank = realRerank;
		console.log(
			`[${stage}] ${rows.length}개 질의 완료: ${((performance.now() - t0) / 1000).toFixed(1)}s`,
		);
	}

	// ---------- 집계 ----------
	const medianOverlap = percentile(
		rows.map((r) => r.query.overlap),
		50,
	);
	const groups: Array<{ name: string; rows: Row[] }> = [
		{ name: "전체", rows },
		{
			name: "type1 패러프레이즈",
			rows: rows.filter((r) => r.query.type === 1),
		},
		{
			name: "type2 다중 문장 추론",
			rows: rows.filter((r) => r.query.type === 2),
		},
		{
			name: `어휘 겹침 높음 (>${medianOverlap.toFixed(2)})`,
			rows: rows.filter((r) => r.query.overlap > medianOverlap),
		},
		{
			name: `어휘 겹침 낮음 (≤${medianOverlap.toFixed(2)})`,
			rows: rows.filter((r) => r.query.overlap <= medianOverlap),
		},
	];

	const lines: string[] = [];
	if (args.smoke) {
		lines.push(
			"> ⚠️ SMOKE MODE: 장난감 모델로 코드 경로만 점검한 결과입니다. 아래 수치는 품질 지표가 아닙니다.",
			"",
		);
	}
	lines.push(
		"# 검색 품질 평가 (KLUE-MRC v1.1 dev)",
		"",
		`- 문서 ${docs.length}개, 질의 ${rows.length}개, seed=${args.seed}, top-${TOP_K}`,
		`- 측정 단계: ${stages.join(", ")}`,
		"- 미검률 = 정답 문단이 상위 10개 안에 없는 비율",
		"",
	);

	for (const group of groups) {
		if (group.rows.length === 0) continue;
		lines.push(
			`## ${group.name} (n=${group.rows.length})`,
			"",
			"| 단계 | Hit@1 | Hit@5 | Hit@10 | 미검률@10 | MRR@10 | 평균 ms | p95 ms |",
			"|---|---|---|---|---|---|---|---|",
		);
		for (const stage of stages) {
			const s = summarize(group.rows, stage);
			lines.push(
				`| ${STAGE_LABEL[stage]} | ${pct(s.hit1)} | ${pct(s.hit5)} | ${pct(s.hit10)} | ${pct(s.miss10)} | ${s.mrr10.toFixed(3)} | ${s.msMean.toFixed(1)} | ${s.msP95.toFixed(1)} |`,
			);
		}
		lines.push("");
	}

	if (stages.includes("hybrid_prod")) {
		// AI 재판정이 1차 결과의 1순위를 바로잡았는지/망가뜨렸는지 질의 단위로 비교한다.
		let fixed = 0;
		let broken = 0;
		let bothRight = 0;
		let bothWrong = 0;
		let rescued10 = 0;
		let lost10 = 0;
		for (const row of rows) {
			const before = rankOf(row.stages.hybrid_rrf, row.query.goldId);
			const after = rankOf(row.stages.hybrid_prod, row.query.goldId);
			const b1 = before === 0;
			const a1 = after === 0;
			if (b1 && a1) bothRight++;
			else if (!b1 && a1) fixed++;
			else if (b1 && !a1) broken++;
			else bothWrong++;
			if (before < 0 && after >= 0) rescued10++;
			if (before >= 0 && after < 0) lost10++;
		}
		const hybridSkipped = rows.filter(
			(r) =>
				!r.stages.hybrid_prod?.rerankCalls?.some((c) => c.site === "hybrid"),
		);
		const hybridReranked = rows.filter((r) =>
			r.stages.hybrid_prod?.rerankCalls?.some((c) => c.site === "hybrid"),
		);
		const semanticSkipped = rows.filter(
			(r) =>
				!r.stages.hybrid_prod?.rerankCalls?.some((c) => c.site === "semantic"),
		);
		const rerankMs = rows.map((r) =>
			(r.stages.hybrid_prod?.rerankCalls ?? []).reduce((a, c) => a + c.ms, 0),
		);
		const totalMs = rows.map((r) => r.stages.hybrid_prod?.ms ?? 0);
		const sumRerankMs = rerankMs.reduce((a, b) => a + b, 0);
		const sumTotalMs = totalMs.reduce((a, b) => a + b, 0);
		const hit1Of = (subset: Row[]) =>
			subset.length === 0
				? "-"
				: pct(
						subset.filter(
							(r) => rankOf(r.stages.hybrid_prod, r.query.goldId) === 0,
						).length / subset.length,
					);

		lines.push(
			"## AI 재판정 효과 (1차 RRF 결과 대비, 질의 단위)",
			"",
			"| 1순위 변화 | 질의 수 | 비율 |",
			"|---|---|---|",
			`| 1차 오답 → 재판정 후 정답 (바로잡음) | ${fixed} | ${pct(fixed / rows.length)} |`,
			`| 1차 정답 → 재판정 후 오답 (오판) | ${broken} | ${pct(broken / rows.length)} |`,
			`| 둘 다 정답 | ${bothRight} | ${pct(bothRight / rows.length)} |`,
			`| 둘 다 오답 | ${bothWrong} | ${pct(bothWrong / rows.length)} |`,
			"",
			`- 상위 10개 밖 → 안으로 구제: ${rescued10}건, 안 → 밖으로 탈락: ${lost10}건`,
			"",
			"## 재판정 생략 정책 (거리 0.2 미만이면 리랭킹 생략)",
			"",
			`- RRF 이후 재판정 생략: ${hybridSkipped.length}/${rows.length} (${pct(hybridSkipped.length / rows.length)}), 생략한 질의의 Hit@1 ${hit1Of(hybridSkipped)} / 재판정한 질의의 Hit@1 ${hit1Of(hybridReranked)}`,
			`- 벡터 검색 내부 재판정 생략: ${semanticSkipped.length}/${rows.length} (${pct(semanticSkipped.length / rows.length)})`,
			...(() => {
				const distances = rows
					.map((r) => r.stages.semantic?.topDistance)
					.filter((v): v is number => typeof v === "number");
				if (distances.length === 0) return [];
				const below = distances.filter((d) => d < 0.2).length;
				return [
					`- 벡터 검색 1위 거리 분포: 최소 ${Math.min(...distances).toFixed(3)}, 중앙값 ${percentile(distances, 50).toFixed(3)}, 0.2 미만 ${below}/${distances.length}`,
				];
			})(),
			`- 실제 서버 경로 처리 시간 중 리랭커 비중: ${pct(sumRerankMs / Math.max(1, sumTotalMs))} (질의당 평균 ${(sumRerankMs / rows.length).toFixed(1)}ms)`,
			"",
		);
	}

	const summary = lines.join("\n");
	await writeFile(join(outDir, "summary.md"), summary, "utf8");
	await writeFile(
		join(outDir, "results.json"),
		JSON.stringify(
			{
				args,
				docs: docs.length,
				medianOverlap,
				stages,
				rows: rows.map((r) => ({
					...r.query,
					ranks: Object.fromEntries(
						stages.map((s) => [s, rankOf(r.stages[s], r.query.goldId)]),
					),
					ms: Object.fromEntries(stages.map((s) => [s, r.stages[s]?.ms])),
					rerankCalls: r.stages.hybrid_prod?.rerankCalls,
					semanticTopDistance: r.stages.semantic?.topDistance,
				})),
			},
			null,
			2,
		),
		"utf8",
	);
	console.log(`\n${summary}`);
	console.log(`결과 저장: ${join(outDir, "summary.md")}, results.json`);

	await localModelManager.shutdown();
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
