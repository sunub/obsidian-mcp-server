/**
 * 긴 대화에서 앞쪽 정보를 기억하는지 측정한다 (CLI 대화 이력 관리 평가).
 *
 * 세션마다 대화 이력을 조건별 방식으로 줄인 뒤, 대화 중에 나왔던 사실 10개를 하나씩 질문하고
 * 답에 정답 키워드가 들어 있는지 채점한다.
 *
 *   window6000       수정 전 CLI: 최근 6,000자만 남김 (utils.truncateHistory)
 *   full             자르지 않음. 모델 서버가 컨텍스트 한도에서 앞부분을 잘라냄
 *   legacy           수정 전 compress.ts (CLI에 연결된 적 없음). 기준만 낮춰 실행
 *   compress-rewrite 첫 설계: 토큰 기준으로 나눠 요약하되 조각마다 모델이 스냅샷 전체를 다시 씀
 *   compress         최종 설계: 사용자 발화 원문 보존 + 조각별 사실 추출을 코드가 덧붙임
 *   compress-verify  최종 설계 + 조각마다 빠진 사실 보완 호출
 *
 * 사용법 (먼저 npx tsc && npx tsc-alias)
 *   npx tsx scripts/eval/context-memory.ts --api http://127.0.0.1:11434 --model exaone3.5:7.8b
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { mean, pairedBootstrap } from "./lib/metrics.js";

const { values: args } = parseArgs({
	options: {
		sessions: { type: "string", default: "eval/context/sessions.json" },
		api: { type: "string", default: "http://127.0.0.1:11434" },
		model: { type: "string", default: "exaone3.5:7.8b" },
		context: { type: "string", default: "16384" },
		conditions: {
			type: "string",
			default:
				"window6000,full,legacy,compress-rewrite,compress,compress-verify",
		},
		"legacy-threshold": { type: "string", default: "20000" },
		out: { type: "string", default: "eval/context/results" },
		session: { type: "string" },
	},
});

// 제품 코드(llmService)가 읽는 설정을 먼저 정한다
process.env["LLM_API_URL"] = args.api;
process.env["LLM_CHAT_MODEL"] = args.model;
process.env["LLM_TIMEOUT_MS"] = "600000";
const CONTEXT = Number(args.context);

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string };
type Probe = {
	id: string;
	turn: number;
	role: string;
	question: string;
	answers: string[];
};
type Session = {
	topic: string;
	messages: Msg[];
	probes: Probe[];
	chars: number;
};

const { truncateHistory } = await import(
	"../../build/cli/hooks/useLlmStream/utils.js"
);
const { compressHistory, fitToContext, estimateTokens } = await import(
	"../../build/cli/hooks/useLlmStream/compress.js"
);
const legacy = await import("./lib/legacy-compress.js");
legacy.setLegacyThreshold(Number(args["legacy-threshold"]));

const sessions: Record<string, Session> = JSON.parse(
	await readFile(args.sessions as string, "utf-8"),
);

type Prepared = {
	history: Msg[];
	compressMs: number;
	llmCalls: number;
	historyTokens: number;
	snapshot: string;
};

async function prepare(condition: string, messages: Msg[]): Promise<Prepared> {
	const t0 = performance.now();
	let history: Msg[] = messages;
	let llmCalls = 0;
	if (condition === "window6000") {
		// 수정 전 CLI는 질문을 붙인 뒤 전체를 6,000자로 잘랐다. 질문 자리를 비워 두고 같은 계산을 한다
		history = truncateHistory(
			[...messages, { role: "user", content: "" }],
			6000,
		).slice(0, -1);
	} else if (condition === "legacy") {
		history = await legacy.compressHistory(messages as never);
		llmCalls = history === messages ? 0 : 2;
	} else if (condition.startsWith("compress")) {
		const result = await compressHistory(messages as never, {
			contextTokens: CONTEXT,
			verify: condition === "compress-verify",
			mode: condition === "compress-rewrite" ? "rewrite" : "append",
		});
		history = fitToContext(result.messages, Math.floor(CONTEXT * 0.7)) as Msg[];
		llmCalls = result.stats.llmCalls;
	}
	const snapshot =
		history.find((m) => m.content.includes("<state_snapshot>"))?.content ??
		history.find((m) => m.content.startsWith("이전 작업 요약"))?.content ??
		"";
	return {
		history,
		compressMs: performance.now() - t0,
		llmCalls,
		historyTokens: history.reduce((s, m) => s + estimateTokens(m.content), 0),
		snapshot,
	};
}

async function ask(history: Msg[], question: string) {
	const body = {
		model: args.model,
		messages: [
			...history,
			{
				role: "user",
				content: `${question}\n앞선 대화에 근거해 답만 짧게 쓰세요. 대화에서 찾을 수 없으면 "모름"이라고만 답하세요.`,
			},
		],
		stream: false,
		temperature: 0,
		max_tokens: 60,
	};
	const res = await fetch(`${args.api}/v1/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = (await res.json()) as {
		choices: { message: { content: string } }[];
		usage: { prompt_tokens: number };
	};
	return {
		answer: json.choices[0]?.message.content?.trim() ?? "",
		promptTokens: json.usage?.prompt_tokens ?? 0,
	};
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const hit = (text: string, answers: string[]) =>
	answers.some((a) => normalize(text).includes(normalize(a)));

const conditions = (args.conditions as string).split(",");
type Row = {
	session: string;
	condition: string;
	probe: string;
	turn: number;
	correct: number;
	inSnapshot: number | null;
	answer: string;
	promptTokens: number;
};
const rows: Row[] = [];
const prepStats: Record<string, unknown>[] = [];
await mkdir(args.out as string, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

for (const [name, session] of Object.entries(sessions)) {
	if (args.session && args.session !== name) continue;
	for (const condition of conditions) {
		const prepared = await prepare(condition, session.messages);
		prepStats.push({
			session: name,
			condition,
			compressSeconds: prepared.compressMs / 1000,
			llmCalls: prepared.llmCalls,
			historyTokens: prepared.historyTokens,
			snapshotChars: prepared.snapshot.length,
		});
		for (const probe of session.probes) {
			const { answer, promptTokens } = await ask(
				prepared.history,
				probe.question,
			);
			rows.push({
				session: name,
				condition,
				probe: probe.id,
				turn: probe.turn,
				correct: hit(answer, probe.answers) ? 1 : 0,
				inSnapshot: prepared.snapshot
					? hit(prepared.snapshot, probe.answers)
						? 1
						: 0
					: null,
				answer,
				promptTokens,
			});
		}
		const done = rows.filter(
			(r) => r.session === name && r.condition === condition,
		);
		console.error(
			`[ctx] ${name.padEnd(13)} ${condition.padEnd(16)} 정답 ${done.reduce((s, r) => s + r.correct, 0)}/${done.length}  요약 ${(prepared.compressMs / 1000).toFixed(0)}s  호출 ${prepared.llmCalls}  이력 ${prepared.historyTokens}tok  질문당 입력 ${Math.round(mean(done.map((r) => r.promptTokens)))}tok`,
		);
		await writeFile(
			join(args.out as string, `context-${stamp}.partial.json`),
			JSON.stringify({ rows, prepStats }, null, 2),
		);
	}
}

// ---------- 요약 ----------
const byCondition = Object.fromEntries(
	conditions.map((c) => {
		const r = rows.filter((x) => x.condition === c);
		const early = r.filter((x) => x.turn <= 4);
		const late = r.filter((x) => x.turn >= 10);
		const prep = prepStats.filter((p) => p.condition === c) as {
			compressSeconds: number;
			llmCalls: number;
			historyTokens: number;
		}[];
		return [
			c,
			{
				accuracy: mean(r.map((x) => x.correct)),
				earlyAccuracy: mean(early.map((x) => x.correct)),
				lateAccuracy: mean(late.map((x) => x.correct)),
				snapshotRetention: r.some((x) => x.inSnapshot !== null)
					? mean(
							r
								.filter((x) => x.inSnapshot !== null)
								.map((x) => x.inSnapshot as number),
						)
					: null,
				meanPromptTokens: mean(r.map((x) => x.promptTokens)),
				meanCompressSeconds: mean(prep.map((p) => p.compressSeconds)),
				meanLlmCalls: mean(prep.map((p) => p.llmCalls)),
				meanHistoryTokens: mean(prep.map((p) => p.historyTokens)),
			},
		];
	}),
);
const ids = rows
	.filter((r) => r.condition === conditions[0])
	.map((r) => r.probe);
const vector = (c: string) =>
	ids.map(
		(id) => rows.find((r) => r.condition === c && r.probe === id)?.correct ?? 0,
	);
const paired: Record<string, unknown> = {};
for (const [a, b] of [
	["window6000", "compress"],
	["full", "compress"],
	["legacy", "compress"],
	["compress-rewrite", "compress"],
	["compress", "compress-verify"],
]) {
	if (conditions.includes(a as string) && conditions.includes(b as string)) {
		paired[`${a}→${b}`] = pairedBootstrap(
			vector(a as string),
			vector(b as string),
		);
	}
}
const result = {
	environment: {
		date: new Date().toISOString(),
		api: args.api,
		model: args.model,
		contextTokens: CONTEXT,
		legacyThresholdChars: Number(args["legacy-threshold"]),
	},
	sessions: Object.fromEntries(
		Object.entries(sessions).map(([k, s]) => [
			k,
			{ chars: s.chars, messages: s.messages.length, probes: s.probes.length },
		]),
	),
	byCondition,
	paired,
	prepStats,
	rows,
};
const outFile = join(args.out as string, `context-${stamp}.json`);
await writeFile(outFile, JSON.stringify(result, null, 2));
console.error(JSON.stringify(byCondition, null, 1));
console.error(JSON.stringify(paired, null, 1));
console.error(`결과 저장: ${outFile}`);
process.exit(0);
