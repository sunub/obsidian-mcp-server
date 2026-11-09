import { describe, expect, test, vi } from "vitest";
import {
	chunkForSummary,
	compressHistory,
	findRecentSplit,
	fitToContext,
	isSnapshotMessage,
	SNAPSHOT_ACK,
} from "../../src/cli/hooks/useLlmStream/compress.js";
import type { ConversationMessage } from "../../src/cli/hooks/useLlmStream/types.js";

// 글자 수 = 토큰 수로 두어 계산을 예측 가능하게 한다
const estimate = (text: string) => text.length;

function turns(count: number, size: number): ConversationMessage[] {
	return Array.from({ length: count }, (_, i) => [
		{ role: "user" as const, content: `q${i}`.padEnd(size, ".") },
		{ role: "assistant" as const, content: `a${i}`.padEnd(size, ".") },
	]).flat();
}

describe("대화 압축", () => {
	test("한도 비율을 넘지 않으면 모델을 부르지 않고 그대로 돌려준다", async () => {
		const summarize = vi.fn();
		const messages = turns(2, 100);
		const result = await compressHistory(messages, {
			contextTokens: 10_000,
			estimateTokens: estimate,
			summarize,
		});
		expect(result.compressed).toBe(false);
		expect(result.messages).toBe(messages);
		expect(summarize).not.toHaveBeenCalled();
	});

	test("append: 사용자 발화는 원문 그대로, 결정은 조각마다 뽑아 덧붙이고 최근 턴은 원문으로 남긴다", async () => {
		let call = 0;
		const summarize = vi.fn(async () => {
			call++;
			return `- 결정${call}\n일반 설명 문장\n- 없음`;
		});
		const messages = turns(10, 500); // 20개 메시지, 약 10,000 토큰
		messages[0] = { role: "user", content: "커밋 접두사는 perf-lcp: 로 해 줘" };
		const result = await compressHistory(messages, {
			contextTokens: 10_000,
			triggerRatio: 0.5,
			keepRecentRatio: 0.2,
			chunkRatio: 0.3,
			estimateTokens: estimate,
			summarize,
		});

		expect(result.compressed).toBe(true);
		expect(result.stats.chunks).toBeGreaterThan(1);
		expect(summarize).toHaveBeenCalledTimes(result.stats.chunks);
		const snapshot = result.messages[0]?.content ?? "";
		expect(isSnapshotMessage(result.messages[0] as ConversationMessage)).toBe(
			true,
		);
		expect(snapshot).toContain("- 커밋 접두사는 perf-lcp: 로 해 줘");
		// 모든 조각의 결정이 순서대로 남고, "- 없음"과 목록이 아닌 줄은 버린다
		for (let i = 1; i <= result.stats.chunks; i++)
			expect(snapshot).toContain(`- 결정${i}`);
		expect(snapshot).not.toContain("일반 설명 문장");
		expect(snapshot).not.toContain("- 없음");
		expect(result.messages[1]?.content).toBe(SNAPSHOT_ACK);
		expect(result.messages[2]?.role).toBe("user");
		expect(result.messages.at(-1)).toEqual(messages.at(-1));
		expect(result.stats.tokensAfter).toBeLessThan(result.stats.tokensBefore);
	});

	test("append + verify: 조각마다 빠진 사실만 추가로 받아 덧붙인다", async () => {
		const summarize = vi.fn(async (msgs: ConversationMessage[]) =>
			msgs.length > 2 ? "- 보완한 사실" : "- 첫 사실",
		);
		const result = await compressHistory(turns(10, 500), {
			contextTokens: 10_000,
			chunkRatio: 0.9,
			verify: true,
			estimateTokens: estimate,
			summarize,
		});
		expect(result.stats.llmCalls).toBe(result.stats.chunks * 2);
		expect(result.messages[0]?.content).toContain("- 첫 사실");
		expect(result.messages[0]?.content).toContain("- 보완한 사실");
	});

	test("append: 이전 스냅샷의 내용을 모델에 다시 쓰게 하지 않고 그대로 이어 붙인다", async () => {
		const prompts: string[] = [];
		const summarize = vi.fn(async (msgs: ConversationMessage[]) => {
			prompts.push(msgs[1]?.content ?? "");
			return "- 새 결정";
		});
		const messages: ConversationMessage[] = [
			{
				role: "user",
				content:
					"이전 대화 요약:\n\n<state_snapshot>\n[사용자 지시 원문]\n- 옛 지시\n\n[결정과 결과]\n- PORT=8765\n</state_snapshot>",
			},
			{ role: "assistant", content: SNAPSHOT_ACK },
			...turns(10, 500),
		];
		const result = await compressHistory(messages, {
			contextTokens: 10_000,
			chunkRatio: 0.9,
			estimateTokens: estimate,
			summarize,
		});
		const snapshot = result.messages[0]?.content ?? "";
		expect(result.compressed).toBe(true);
		expect(snapshot).toContain("- 옛 지시");
		expect(snapshot).toContain("- PORT=8765");
		expect(snapshot).toContain("- 새 결정");
		expect(prompts.join("")).not.toContain(SNAPSHOT_ACK);
	});

	test("rewrite: 조각마다 앞 조각의 스냅샷을 넘겨 전체를 다시 쓰게 한다", async () => {
		const prompts: string[] = [];
		const summarize = vi.fn(async (msgs: ConversationMessage[]) => {
			prompts.push(msgs[1]?.content ?? "");
			return `<state_snapshot>요약${prompts.length}</state_snapshot>`;
		});
		const result = await compressHistory(turns(10, 500), {
			contextTokens: 10_000,
			triggerRatio: 0.5,
			chunkRatio: 0.3,
			mode: "rewrite",
			estimateTokens: estimate,
			summarize,
		});
		expect(result.compressed).toBe(true);
		expect(prompts[1]).toContain("요약1");
		expect(result.messages[0]?.content).toContain(`요약${prompts.length}`);
	});

	test("모델 호출이 실패하면 원본을 그대로 돌려준다", async () => {
		const messages = turns(10, 500);
		const failed = await compressHistory(messages, {
			contextTokens: 10_000,
			estimateTokens: estimate,
			summarize: async () => {
				throw new Error("server down");
			},
		});
		expect(failed.compressed).toBe(false);
		expect(failed.messages).toBe(messages);

		const emptyRewrite = await compressHistory(messages, {
			contextTokens: 10_000,
			mode: "rewrite",
			estimateTokens: estimate,
			summarize: async () => "",
		});
		expect(emptyRewrite.compressed).toBe(false);
	});

	test("최근 대화는 user 턴 경계에서만 자른다", () => {
		const messages: ConversationMessage[] = [
			{ role: "user", content: "u1".padEnd(100, ".") },
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{
						id: "t",
						type: "function",
						function: { name: "vault", arguments: "{}" },
					},
				],
			},
			{ role: "tool", content: "r".padEnd(100, "."), tool_call_id: "t" },
			{ role: "assistant", content: "a1".padEnd(100, ".") },
			{ role: "user", content: "u2".padEnd(100, ".") },
			{ role: "assistant", content: "a2".padEnd(100, ".") },
		];
		// 250 토큰이면 도구 결과 중간까지 들어가지만, 경계는 u2에서 정해져야 한다
		expect(findRecentSplit(messages, 250, estimate)).toBe(4);
	});

	test("예산보다 큰 메시지 하나는 여러 조각으로 나눈다", () => {
		const chunks = chunkForSummary(
			[{ role: "assistant", content: "x".repeat(1000) }],
			300,
			estimate,
		);
		expect(chunks.length).toBeGreaterThanOrEqual(4);
		expect(chunks.every((c) => c.length <= 300)).toBe(true);
	});

	test("fitToContext는 system과 스냅샷을 지키고 오래된 대화부터 버린다", () => {
		const messages: ConversationMessage[] = [
			{ role: "system", content: "s".repeat(100) },
			{
				role: "user",
				content: "이전 대화 요약:\n<state_snapshot>x</state_snapshot>",
			},
			{ role: "assistant", content: SNAPSHOT_ACK },
			...turns(3, 200),
		];
		const fitted = fitToContext(messages, 700, estimate);
		expect(fitted[0]?.role).toBe("system");
		expect(isSnapshotMessage(fitted[1] as ConversationMessage)).toBe(true);
		expect(fitted.at(-1)).toEqual(messages.at(-1));
		expect(fitted.length).toBeLessThan(messages.length);
	});
});
