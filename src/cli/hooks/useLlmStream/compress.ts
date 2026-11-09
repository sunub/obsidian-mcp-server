import { getEncoding, type Tiktoken } from "js-tiktoken";
import { callLLMStreaming } from "./llmService.js";
import type { ConversationMessage } from "./types.js";

/**
 * 대화 압축
 *
 * 로컬 모델은 컨텍스트 한도(기본 16K 토큰)를 넘는 입력을 에러 없이 앞에서부터 잘라낸다.
 * 그래서 대화가 한도의 일정 비율을 넘으면 오래된 턴을 상태 스냅샷으로 바꾸고,
 * 최근 턴만 원문으로 남긴다.
 *
 * 스냅샷은 두 부분으로 만든다(mode "append", 기본값).
 * - 사용자 지시 원문: 제약과 규칙이 담긴 사용자 발화는 요약하지 않고 그대로 옮긴다.
 * - 결정과 결과: 요약할 분량을 한도에 맞는 조각으로 나눠, 조각마다 모델이 구체적인 값이 있는
 *   결정·결과만 한 줄씩 뽑고 코드가 뒤에 덧붙인다. 모델이 스냅샷 전체를 다시 쓰지 않으므로
 *   조각을 이어 가며 앞의 정보를 잃지 않는다.
 * mode "rewrite"는 모델이 조각마다 스냅샷 전체를 다시 쓰는 첫 설계로, 평가 비교용으로 남겨 둔다.
 *
 * 설계와 기본값은 scripts/eval/context-memory.ts 평가로 정했다.
 */

export const SNAPSHOT_MARKER = "<state_snapshot>";
export const SNAPSHOT_ACK =
	"이전 대화 요약을 확인했습니다. 요약과 이후 대화를 바탕으로 이어서 진행하겠습니다.";

export interface CompressOptions {
	/** 모델 컨텍스트 한도(토큰) */
	contextTokens: number;
	/** 대화가 한도의 이 비율을 넘으면 압축한다 */
	triggerRatio?: number;
	/** 최근 대화를 원문으로 남길 분량(한도 대비 비율) */
	keepRecentRatio?: number;
	/** 요약 호출 한 번에 넣을 대화 분량(한도 대비 비율). 프롬프트와 출력 여유를 뺀 값 */
	chunkRatio?: number;
	/** 조각마다 요약 뒤 누락 여부를 한 번 더 확인할지 */
	verify?: boolean;
	/** append: 사용자 발화 원문 + 조각별 사실 덧붙이기(기본), rewrite: 조각마다 전체 재작성 */
	mode?: "append" | "rewrite";
	signal?: AbortSignal;
	/** 요약을 시작하기 직전에 한 번 호출된다(화면에 진행 상태를 알리는 용도) */
	onCompressStart?: () => void;
	/** 테스트용: 토큰 수 추정 함수 */
	estimateTokens?: (text: string) => number;
	/** 테스트용: 요약 모델 호출 */
	summarize?: (
		messages: ConversationMessage[],
		signal?: AbortSignal,
	) => Promise<string>;
}

export interface CompressResult {
	messages: ConversationMessage[];
	compressed: boolean;
	stats: {
		tokensBefore: number;
		tokensAfter: number;
		chunks: number;
		llmCalls: number;
	};
}

const DEFAULTS = {
	triggerRatio: 0.6,
	keepRecentRatio: 0.2,
	chunkRatio: 0.45,
	verify: false,
	mode: "append" as "append" | "rewrite",
};

/** 사용자 발화 한 개를 스냅샷에 옮길 때의 최대 글자 수 */
const USER_LINE_CHARS = 400;

const FACT_SYSTEM_PROMPT = `당신은 대화 기록에서 나중에 다시 필요할 구체적인 사실만 뽑아 적는 기록 관리자입니다.
다음에 해당하는 것만 한 줄에 하나씩 "- "로 시작해 쓰십시오.
- 확정된 경로, 파일명, 브랜치, 도메인, 버전, 설정값, 숫자, 측정 결과
- 원인과 해결 방법, 선택한 도구·모델·방식
- 사용자가 정한 규칙, 금지 사항, 기준값, 담당자, 일정 조건

문서의 일반적인 설명, 개념 정리, 코드 예시는 절대 쓰지 마십시오.
값은 원문 표기 그대로 옮기십시오. 해당하는 것이 없으면 "- 없음"만 쓰십시오.`;

const COMPRESSION_SYSTEM_PROMPT = `당신은 대화 기록에서 이후 작업에 필요한 정보를 빠짐없이 옮겨 적는 기록 관리자입니다.
<state_snapshot> ... </state_snapshot> 형식의 문서 하나만 출력하십시오. 인사말이나 설명은 쓰지 마십시오.

반드시 다음 항목을 포함하십시오.
1. [목표와 진행 상태]: 사용자가 진행 중인 작업과 현재 단계
2. [사용자 제약과 규칙]: 사용자가 지시한 금지 사항, 형식, 기준값, 담당자, 일정 조건
3. [결정과 결과]: 확정된 경로, 파일, 버전, 설정값, 측정 수치, 원인과 해결 방법
4. [도구 결과]: 성공한 결과와 실패에서 얻은 교훈

경로, 파일명, 버전, 숫자, 이름, 시간은 원문 표기 그대로 옮기십시오. 일반적인 설명 내용은 한 줄로 줄여도 되지만,
위 항목에 해당하는 구체적인 값은 절대 생략하지 마십시오.`;

let encoder: Tiktoken | null = null;

/**
 * cl100k 기준 토큰 수. 한국어 문서에서 실제 로컬 모델(EXAONE 3.5, Qwen 3.5) 토큰 수의
 * 1.1~1.7배로 나와, 한도를 넘지 않는 쪽으로 보수적인 추정치가 된다.
 */
export function estimateTokens(text: string): number {
	if (!encoder) encoder = getEncoding("cl100k_base");
	return encoder.encode(text).length;
}

function messageText(message: ConversationMessage): string {
	const calls =
		message.role === "assistant" && message.tool_calls?.length
			? `\n[도구 호출] ${message.tool_calls.map((c) => `${c.function.name}(${c.function.arguments})`).join(", ")}`
			: "";
	return `${message.content}${calls}`;
}

function messageTokens(
	message: ConversationMessage,
	estimate: (text: string) => number,
): number {
	return estimate(messageText(message)) + 4;
}

export function isSnapshotMessage(message: ConversationMessage): boolean {
	return message.role === "user" && message.content.includes(SNAPSHOT_MARKER);
}

/**
 * 최근 대화를 keepTokens 안에서 최대한 남기되, 반드시 user 턴이 시작하는 지점에서 자른다.
 * 도구 호출과 그 결과가 둘로 갈라지지 않게 하기 위해서다.
 */
export function findRecentSplit(
	messages: ConversationMessage[],
	keepTokens: number,
	estimate: (text: string) => number,
): number {
	let used = 0;
	let split = messages.length;
	for (let i = messages.length - 1; i >= 0; i--) {
		used += messageTokens(messages[i] as ConversationMessage, estimate);
		if (used > keepTokens) break;
		if (
			messages[i]?.role === "user" &&
			!isSnapshotMessage(messages[i] as ConversationMessage)
		) {
			split = i;
		}
	}
	// 마지막 user 턴 하나는 항상 원문으로 남긴다
	if (split === messages.length) {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i]?.role === "user") return i;
		}
	}
	return split;
}

/** 요약할 대화를 토큰 예산 안의 조각으로 나눈다. 한 메시지가 예산보다 크면 글자 기준으로 자른다. */
export function chunkForSummary(
	messages: ConversationMessage[],
	chunkTokens: number,
	estimate: (text: string) => number,
): string[] {
	const chunks: string[] = [];
	let current = "";
	let currentTokens = 0;
	const push = () => {
		if (current.trim()) chunks.push(current.trim());
		current = "";
		currentTokens = 0;
	};
	for (const message of messages) {
		const line = `[${message.role}]\n${messageText(message)}\n\n`;
		const tokens = estimate(line);
		if (tokens > chunkTokens) {
			push();
			const pieces = Math.ceil(tokens / chunkTokens);
			const size = Math.ceil(line.length / pieces);
			for (let i = 0; i < line.length; i += size) {
				chunks.push(line.slice(i, i + size).trim());
			}
			continue;
		}
		if (currentTokens + tokens > chunkTokens) push();
		current += line;
		currentTokens += tokens;
	}
	push();
	return chunks;
}

async function summarizeWithModel(
	messages: ConversationMessage[],
	signal?: AbortSignal,
): Promise<string> {
	let text = "";
	for await (const event of callLLMStreaming(
		messages,
		undefined,
		false,
		signal,
	)) {
		if (event.type === "content") text += event.chunk;
	}
	return text.trim();
}

function extractSnapshot(text: string): string {
	const match = text.match(/<state_snapshot>[\s\S]*?(<\/state_snapshot>|$)/);
	const body = (match ? match[0] : text).trim();
	return body.startsWith(SNAPSHOT_MARKER)
		? body
		: `${SNAPSHOT_MARKER}\n${body}\n</state_snapshot>`;
}

type SnapshotSections = { user: string[]; facts: string[] };

function parseBullets(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^([-*•]|\d+[.)])\s+/.test(line))
		.map((line) => line.replace(/^([-*•]|\d+[.)])\s+/, "").trim())
		.filter((line) => line && !/^없음\.?$/.test(line));
}

function parseSnapshot(snapshot: string): SnapshotSections {
	const sections: SnapshotSections = { user: [], facts: [] };
	let current: string[] | null = null;
	for (const line of snapshot.split("\n")) {
		if (line.startsWith("[사용자 지시 원문]")) current = sections.user;
		else if (line.startsWith("[결정과 결과]")) current = sections.facts;
		else if (current && line.startsWith("- ")) current.push(line.slice(2));
	}
	return sections;
}

function renderSnapshot(sections: SnapshotSections): string {
	const unique = (lines: string[]) => [...new Set(lines)];
	return [
		SNAPSHOT_MARKER,
		"[사용자 지시 원문]",
		...unique(sections.user).map((l) => `- ${l}`),
		"",
		"[결정과 결과]",
		...unique(sections.facts).map((l) => `- ${l}`),
		"</state_snapshot>",
	].join("\n");
}

async function rewriteSnapshot(
	snapshot: string,
	chunk: string,
	summarize: (m: ConversationMessage[], s?: AbortSignal) => Promise<string>,
	verify: boolean,
	signal?: AbortSignal,
): Promise<{ text: string; calls: number }> {
	const request = (extra: string): ConversationMessage[] => [
		{ role: "system", content: COMPRESSION_SYSTEM_PROMPT },
		{
			role: "user",
			content: `${snapshot ? `지금까지의 스냅샷:\n${snapshot}\n\n` : ""}이어지는 대화 기록:\n${chunk}\n\n${extra}`,
		},
	];
	const instruction = snapshot
		? "기존 스냅샷의 내용을 모두 유지하면서 이어지는 대화 기록의 정보를 병합한 새 스냅샷을 작성하십시오."
		: "대화 기록을 바탕으로 새 스냅샷을 작성하십시오.";
	const draft = await summarize(request(instruction), signal);
	if (!draft || !verify) return { text: draft, calls: 1 };
	const verified = await summarize(
		request(
			`방금 작성한 스냅샷입니다:\n${extractSnapshot(draft)}\n\n대화 기록에 있는 경로, 파일명, 버전, 숫자, 이름, 사용자 제약 중 스냅샷에서 빠진 것이 있으면 보완한 최종 스냅샷을, 빠진 것이 없으면 같은 스냅샷을 그대로 출력하십시오.`,
		),
		signal,
	);
	return { text: verified || draft, calls: 2 };
}

export async function compressHistory(
	messages: ConversationMessage[],
	options: CompressOptions,
): Promise<CompressResult> {
	const opts = { ...DEFAULTS, ...options };
	const estimate = opts.estimateTokens ?? estimateTokens;
	const summarize = opts.summarize ?? summarizeWithModel;
	const tokensBefore = messages.reduce(
		(sum, m) => sum + messageTokens(m, estimate),
		0,
	);
	const unchanged = (llmCalls = 0, chunks = 0): CompressResult => ({
		messages,
		compressed: false,
		stats: { tokensBefore, tokensAfter: tokensBefore, chunks, llmCalls },
	});

	if (tokensBefore <= opts.contextTokens * opts.triggerRatio)
		return unchanged();

	const split = findRecentSplit(
		messages,
		Math.floor(opts.contextTokens * opts.keepRecentRatio),
		estimate,
	);
	const older = messages.slice(0, split);
	const recent = messages.slice(split);
	if (older.length === 0) return unchanged();

	// 이미 압축된 적이 있으면 그 스냅샷에서 이어서 만든다
	let previous = "";
	const toSummarize = older.filter((m) => {
		if (isSnapshotMessage(m)) {
			previous = extractSnapshot(m.content);
			return false;
		}
		return !(m.role === "assistant" && m.content === SNAPSHOT_ACK);
	});

	const chunks = chunkForSummary(
		toSummarize,
		Math.floor(opts.contextTokens * opts.chunkRatio),
		estimate,
	);
	let llmCalls = 0;
	let snapshot: string;
	opts.onCompressStart?.();
	try {
		if (opts.mode === "rewrite") {
			snapshot = previous;
			for (const chunk of chunks) {
				const next = await rewriteSnapshot(
					snapshot,
					chunk,
					summarize,
					opts.verify,
					opts.signal,
				);
				llmCalls += next.calls;
				if (!next.text) return unchanged(llmCalls, chunks.length);
				snapshot = extractSnapshot(next.text);
			}
		} else {
			const sections = parseSnapshot(previous);
			for (const m of toSummarize) {
				if (m.role !== "user") continue;
				const line = m.content
					.replace(/\s+/g, " ")
					.trim()
					.slice(0, USER_LINE_CHARS);
				if (line) sections.user.push(line);
			}
			for (const chunk of chunks) {
				const request: ConversationMessage[] = [
					{ role: "system", content: FACT_SYSTEM_PROMPT },
					{ role: "user", content: `대화 기록:\n${chunk}` },
				];
				const facts = parseBullets(await summarize(request, opts.signal));
				llmCalls++;
				if (opts.verify) {
					const missing = parseBullets(
						await summarize(
							[
								...request,
								{
									role: "assistant",
									content: facts.map((f) => `- ${f}`).join("\n") || "- 없음",
								},
								{
									role: "user",
									content:
										'대화 기록에 있는 경로, 파일명, 버전, 숫자, 이름, 사용자 규칙 중 위 목록에서 빠진 것만 같은 형식으로 추가로 쓰십시오. 빠진 것이 없으면 "- 없음"만 쓰십시오.',
								},
							],
							opts.signal,
						),
					);
					llmCalls++;
					facts.push(...missing);
				}
				sections.facts.push(...facts);
			}
			snapshot = renderSnapshot(sections);
		}
	} catch {
		return unchanged(llmCalls, chunks.length);
	}

	const result: ConversationMessage[] = [
		{ role: "user", content: `이전 대화 요약:\n\n${snapshot}` },
		{ role: "assistant", content: SNAPSHOT_ACK },
		...recent,
	];
	const tokensAfter = result.reduce(
		(sum, m) => sum + messageTokens(m, estimate),
		0,
	);
	// 요약이 오히려 커졌다면 압축하지 않은 것으로 본다
	if (tokensAfter >= tokensBefore) return unchanged(llmCalls, chunks.length);

	return {
		messages: result,
		compressed: true,
		stats: { tokensBefore, tokensAfter, chunks: chunks.length, llmCalls },
	};
}

/**
 * 압축 뒤에도 한도를 넘는 경우를 막는 안전장치. 가장 오래된 메시지부터 버리되
 * system 메시지와 스냅샷, 마지막 메시지는 남긴다.
 */
export function fitToContext(
	messages: ConversationMessage[],
	maxTokens: number,
	estimate: (text: string) => number = estimateTokens,
): ConversationMessage[] {
	const result = [...messages];
	let total = result.reduce((sum, m) => sum + messageTokens(m, estimate), 0);
	let i = 0;
	while (total > maxTokens && i < result.length - 1) {
		const message = result[i] as ConversationMessage;
		if (
			message.role === "system" ||
			isSnapshotMessage(message) ||
			message.content === SNAPSHOT_ACK
		) {
			i++;
			continue;
		}
		total -= messageTokens(message, estimate);
		result.splice(i, 1);
	}
	return result;
}
