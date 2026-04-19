/**
 * useRagContext — Vault RAG 컨텍스트 조회 훅
 *
 * 사용자 질문에 대해 MCP 서버를 통해 Obsidian Vault에서
 * 관련 문서를 검색하고, 프롬프트 증강용 컨텍스트로 포맷합니다.
 *
 * 전략: 시맨틱 검색(벡터) → 키워드 검색(폴백)
 */

import { useState, useCallback } from "react";
import { debugLogger } from "../utils/debugLogger.js";
import type { CallToolFn, McpToolResult } from "../types.js";

export interface UseRagContextReturn {
  fetchContext: (query: string) => Promise<string | null>;
  isFetching: boolean;
}

const MAX_CONTEXT_CHARS = 4000;

const ANSI_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences intentionally matched
  /[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[A-Za-z0-9=><~]/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function extractTextFromResult(result: McpToolResult): string {
  return result.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text ?? "")
    .join("\n");
}

function hasValidResults(result: McpToolResult): boolean {
  if (result.isError) {
    return false;
  }
  const text = extractTextFromResult(result);
  return text.length > 0 && !text.includes("No results found");
}

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

      const query = stripAnsi(rawQuery).trim();

      setIsFetching(true);
      debugLogger.log(`[RAG] Fetching context for: "${query}"`);

      try {
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
