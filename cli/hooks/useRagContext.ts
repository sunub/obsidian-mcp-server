/**
 * useRagContext — Vault RAG 컨텍스트 조회 훅
 *
 * 사용자 질문에 대해 MCP 서버를 통해 Obsidian Vault에서
 * 관련 문서를 검색하고, 프롬프트 증강용 컨텍스트로 포맷합니다.
 *
 * 전략: 시맨틱 검색(벡터) → 키워드 검색(폴백)
 */

import { useState, useCallback } from "react";
import { debugLogger } from "../utils/debugLogger.ts";
import type { CallToolFn, McpToolResult } from "../types.ts";

export interface UseRagContextReturn {
	fetchContext: (query: string) => Promise<string | null>;
	isFetching: boolean;
}

/** 컨텍스트에 포함할 최대 문자 수 (토큰 과다 방지) */
const MAX_CONTEXT_CHARS = 4000;

/** ANSI 이스케이프 시퀀스 제거 (터미널 제어 코드가 임베딩을 오염시키는 것 방지) */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences intentionally matched
const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[A-Za-z0-9=><~]/g;
function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

/**
 * MCP 도구 응답에서 텍스트를 추출합니다.
 */
function extractTextFromResult(result: McpToolResult): string {
	return result.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text" && !!c.text)
		.map((c) => c.text)
		.join("\n");
}

/**
 * 검색 결과가 유효한지 (빈 결과가 아닌지) 확인합니다.
 */
function hasValidResults(result: McpToolResult): boolean {
	if (result.isError) return false;
	const text = extractTextFromResult(result);
	return text.length > 0 && !text.includes("No results found");
}

/**
 * 검색 결과를 시스템 프롬프트용 컨텍스트로 포맷합니다.
 */
function formatAsContext(rawText: string): string {
	const truncated =
		rawText.length > MAX_CONTEXT_CHARS
			? `${rawText.slice(0, MAX_CONTEXT_CHARS)}\n... (결과가 잘렸습니다)`
			: rawText;

	return [
		"[Vault Context]",
		"아래는 사용자의 Obsidian Vault에서 찾은 관련 문서입니다. 이 컨텍스트를 참고하여 답변해주세요.",
		"",
		truncated,
		"",
		"[End Vault Context]",
	].join("\n");
}

export const useRagContext = (
	callTool: CallToolFn,
	isConnected: boolean,
): UseRagContextReturn => {
	const [isFetching, setIsFetching] = useState(false);

	const fetchContext = useCallback(
		async (rawQuery: string): Promise<string | null> => {
			if (!isConnected) {
				debugLogger.log("[RAG] MCP not connected, skipping context fetch.");
				return null;
			}

			// ANSI 이스케이프 코드 제거 (터미널 입력에서 유입되는 제어 문자)
			const query = stripAnsi(rawQuery).trim();

			setIsFetching(true);
			debugLogger.log(`[RAG] Fetching context for: "${query}"`);

			try {
				// 1차: 시맨틱 검색 (벡터 DB)
				const semanticResult = await callTool("vault", {
					action: "search_vault_by_semantic",
					query,
					limit: 5,
				});

				if (hasValidResults(semanticResult)) {
					const text = extractTextFromResult(semanticResult);
					debugLogger.log(
						`[RAG] Semantic search returned ${text.length} chars.`,
					);
					return formatAsContext(text);
				}

				debugLogger.log(
					"[RAG] Semantic search empty, falling back to keyword search.",
				);

				// 2차: 키워드 검색 (폴백)
				const keywordResult = await callTool("vault", {
					action: "search",
					keyword: query,
					limit: 5,
					includeContent: true,
					compressionMode: "balanced",
				});

				if (hasValidResults(keywordResult)) {
					const text = extractTextFromResult(keywordResult);
					debugLogger.log(
						`[RAG] Keyword search returned ${text.length} chars.`,
					);
					return formatAsContext(text);
				}

				debugLogger.log("[RAG] No relevant context found in Vault.");
				return null;
			} catch (err) {
				debugLogger.error("[RAG] Context fetch failed:", err);
				return null;
			} finally {
				setIsFetching(false);
			}
		},
		[callTool, isConnected],
	);

	return { fetchContext, isFetching };
};
