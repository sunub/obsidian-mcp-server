import { callLLMStreaming } from "./llmService.js";
import type { ConversationMessage } from "./types.js";

export const COMPRESSION_CHAR_THRESHOLD = 100_000;

const TOOL_RESPONSE_CHAR_BUDGET = 80_000;
const PRESERVE_THRESHOLD = 0.3;
const COMPRESSION_SYSTEM_PROMPT = `
당신은 대화 내역의 핵심 정보를 추출하여 완벽한 상태 문서로 요약하는 상태 저장 관리자입니다.
제공되는 이전 대화 기록을 자세히 분석하여, 대화에 등장한 핵심 사실들을 구조화된 <state_snapshot> 문서로 요약해 주십시오.

반드시 다음 내용을 포함하여 작성해야 합니다:
1. [최상위 목표]: 현재 사용자와 진행 중인 작업의 궁극적 목표와 현재 수행 단계.
2. [핵심 제약 조건]: 사용자가 강조한 환경 조건, 기술적 제한 사항 및 설정 규칙.
3. [수집된 사실/정보]: 지금까지 분석하거나 알아낸 핵심 파일 경로, 디렉토리 구조, 주요 함수 및 API 설정 정보.
4. [도구 결과 요약]: 실행된 시스템 도구 중 성공하여 중요한 성과를 낸 내용 및 실패하여 얻은 교훈(디버깅 흔적).

쓸데없는 서론이나 대화식 응답("네, 알겠습니다" 등)은 전면 생략하고 오직 <state_snapshot> 데이터 구조만 명확히 출력하십시오.
`;

/**
 * 개별 텍스트 줄 수가 한도를 초과할 때 뒷부분 30줄만 보존하는 헬퍼 함수
 */
function truncateTextLines(content: string, limit = 30): string {
	const lines = content.split("\n");
	if (lines.length <= limit) return content;
	const truncated = lines.slice(-limit);
	return `[... 대용량 도구 출력이 너무 길어 앞부분이 생략되었습니다 ...]\n${truncated.join("\n")}`;
}

/**
 * 역방향 누적 버짓 전략:
 * 최근 도구 호출 결과는 중요하므로 보존하되, 오래된 대형 툴 결과물은 순차적으로 잘라내어 컨텍스트를 확보합니다.
 */
export function truncateToolResponsesToBudget(
	history: ConversationMessage[],
): ConversationMessage[] {
	let accumulatedToolChars = 0;
	const resultHistory: ConversationMessage[] = [];

	// 최신 메시지부터 역순으로 탐색
	for (let i = history.length - 1; i >= 0; i--) {
		const msg = history[i];

		if (msg.role === "tool") {
			const charCount = msg.content.length;
			if (accumulatedToolChars + charCount > TOOL_RESPONSE_CHAR_BUDGET) {
				// 예산을 초과하면 마지막 30줄만 남기고 절사
				const truncatedContent = truncateTextLines(msg.content);
				resultHistory.unshift({
					...msg,
					content: truncatedContent,
				});
				accumulatedToolChars += truncatedContent.length;
			} else {
				resultHistory.unshift(msg);
				accumulatedToolChars += charCount;
			}
		} else {
			resultHistory.unshift(msg);
		}
	}

	return resultHistory;
}

/**
 * 대화 내역 중 요약 압축할 지점과 보존할 지점을 분할하는 인덱스를 찾습니다.
 * 흐름을 해치지 않도록 반드시 'user'가 질문하기 직전 지점을 기점으로 분할합니다.
 */
export function findCompressSplitPoint(
	contents: ConversationMessage[],
	fraction: number,
): number {
	if (fraction <= 0 || fraction >= 1) {
		throw new Error("Fraction must be between 0 and 1");
	}

	const charCounts = contents.map((c) => JSON.stringify(c).length);
	const totalCharCount = charCounts.reduce((a, b) => a + b, 0);
	const targetCharCount = totalCharCount * fraction;

	let lastSplitPoint = 0;
	let cumulativeCharCount = 0;

	for (let i = 0; i < contents.length; i++) {
		const content = contents[i];
		// 툴 응답이나 어시스턴트의 중간 연산 과정이 아닌 일반 'user' 시작 턴을 안전 분할점으로 지정
		if (content.role === "user") {
			if (cumulativeCharCount >= targetCharCount) {
				return i;
			}
			lastSplitPoint = i;
		}
		cumulativeCharCount += charCounts[i];
	}

	return lastSplitPoint;
}

/**
 * 1차 스냅샷 요약 및 2차 자가 보정 검증을 통해 핵심 데이터 손실을 차단합니다.
 */
export async function compressHistory(
	messages: ConversationMessage[],
	abortSignal?: AbortSignal,
): Promise<ConversationMessage[]> {
	try {
		const totalLength = messages.reduce(
			(acc, m) => acc + JSON.stringify(m).length,
			0,
		);

		// 임계치를 넘지 않았거나 압축을 하기에 대화 내역이 너무 짧은 경우 생략
		if (totalLength < COMPRESSION_CHAR_THRESHOLD || messages.length < 5) {
			return messages;
		}

		// 1단계: 대용량 툴 결과물 역방향 예산 절사 적용
		const truncatedHistory = truncateToolResponsesToBudget(messages);

		// 2단계: 최신 30% 보존을 위해 분할선 인덱스 탐색
		const splitPoint = findCompressSplitPoint(
			truncatedHistory,
			1 - PRESERVE_THRESHOLD,
		);

		const historyToCompress = truncatedHistory.slice(0, splitPoint);
		const historyToKeep = truncatedHistory.slice(splitPoint);

		if (historyToCompress.length === 0) {
			return messages;
		}

		// 기존에 생성된 스냅샷이 이미 이전 히스토리에 존재하는지 체크
		const hasPreviousSnapshot = historyToCompress.some((m) =>
			m.content.includes("<state_snapshot>"),
		);

		const anchorInstruction = hasPreviousSnapshot
			? "대화 기록 내에 이미 이전 <state_snapshot>이 존재합니다. 이전 스냅샷에 기록된 아직 유효한 중요 세부 사항 및 제약 조건을 반드시 새로 생성할 스냅샷에 완전히 계승·병합하고 최근 사건들을 덧붙여 주십시오."
			: "제공된 대화 내역을 바탕으로 완전히 새로운 <state_snapshot>을 생성해 주십시오.";

		// 3단계: 1차 요약 상태 스냅샷(<state_snapshot>) 생성
		const firstSummarizeMessages: ConversationMessage[] = [
			{ role: "system", content: COMPRESSION_SYSTEM_PROMPT },
			...historyToCompress,
			{
				role: "user",
				content: `${anchorInstruction}\n이전 대화 기록을 분석하여 보존해야 할 핵심 정보(파일 경로, 진행 상태, 제약 조건 등)를 망라한 새로운 <state_snapshot>을 상세히 작성해 주십시오.`,
			},
		];

		let firstSummary = "";
		for await (const event of callLLMStreaming(
			firstSummarizeMessages,
			undefined,
			false,
			abortSignal,
		)) {
			if (event.type === "content") {
				firstSummary += event.chunk;
			}
		}

		firstSummary = firstSummary.trim();
		if (!firstSummary) {
			return messages; // 요약본 생성 실패 시 원본 그대로 보존
		}

		// 4단계: 2차 자가 보정 검증
		const verificationMessages: ConversationMessage[] = [
			{ role: "system", content: COMPRESSION_SYSTEM_PROMPT },
			...historyToCompress,
			{ role: "assistant", content: firstSummary },
			{
				role: "user",
				content:
					"방금 귀하가 작성한 <state_snapshot>에 대화 기록에서 언급된 핵심적인 파일 경로, 코드 함수, 사용자 제약 조건 또는 도구의 성공 결과 중 누락된 부분이 있습니까? 유실되거나 부정확한 정보가 있다면 해당 내용을 보완하여 한 단계 향상된 최종 <state_snapshot> 문서를 새로 작성해 주십시오. 누락된 세부 사항이 전혀 없다면 방금 작성한 스냅샷을 그대로 다시 출력해 주십시오.",
			},
		];

		let finalSummary = "";
		for await (const event of callLLMStreaming(
			verificationMessages,
			undefined,
			false,
			abortSignal,
		)) {
			if (event.type === "content") {
				finalSummary += event.chunk;
			}
		}

		finalSummary = finalSummary.trim() || firstSummary;

		// 5단계: 압축된 스냅샷을 포함하여 새로운 히스토리 구성
		const newHistory: ConversationMessage[] = [
			{
				role: "user",
				content: `이전 작업 요약:\n\n${finalSummary}`,
			},
			{
				role: "assistant",
				content:
					"요약된 이전 작업 상태 스냅샷을 파악했습니다. 이 정보와 남아 있는 최근 대화 맥락을 기반으로 작업을 이어서 진행하겠습니다.",
			},
			...historyToKeep,
		];

		// 압축 결과물의 텍스트 볼륨이 원래보다 부풀려진 예외 케이스 방지
		const newTotalLength = newHistory.reduce(
			(acc, m) => acc + JSON.stringify(m).length,
			0,
		);
		if (newTotalLength >= totalLength) {
			return messages; // 압축 효과가 없거나 부풀어 오른 경우 롤백
		}

		return newHistory;
	} catch {
		return messages;
	}
}
