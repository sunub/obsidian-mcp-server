import type { CallToolFn } from "@cli/types.js";
import { useCallback, useState } from "react";
import { debugLogger } from "@/shared/index.js";

export interface UseRagContextReturn {
	fetchContext: (query: string) => Promise<string | null>;
	isFetching: boolean;
}

const ANSI_RE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences intentionally matched
	/[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[A-Za-z0-9=><~]/g;
function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

interface RagDocument {
	title: string;
	excerpt: string;
	relevance: string;
}

interface RagPayload {
	memory_packet: {
		topicSummary: string;
		keyFacts?: string[];
	};
	documents: RagDocument[];
}

function formatAsContext(payload: RagPayload): string {
	const { memory_packet, documents } = payload;

	const contextParts = [
		"<context>",
		`  <summary>${memory_packet.topicSummary}</summary>`,
	];

	if (memory_packet.keyFacts && memory_packet.keyFacts.length > 0) {
		contextParts.push("  <key_facts>");
		for (const fact of memory_packet.keyFacts) {
			contextParts.push(`    - ${fact}`);
		}
		contextParts.push("  </key_facts>");
	}

	// 연관도가 높은(high) 문서의 본문 조각 추가 (최대 2개)
	const highRelevanceDocs = documents
		.filter((doc) => doc.relevance === "high")
		.slice(0, 2);
	if (highRelevanceDocs.length > 0) {
		contextParts.push("  <detailed_excerpts>");
		for (const doc of highRelevanceDocs) {
			contextParts.push(`    <doc title="${doc.title}">`);
			contextParts.push(`      ${doc.excerpt}`);
			contextParts.push("    </doc>");
		}
		contextParts.push("  </detailed_excerpts>");
	}

	contextParts.push("</context>");

	return contextParts.join("\n");
}

export const useRagContext = (
	callTool: CallToolFn,
	isConnected: boolean,
): UseRagContextReturn => {
	const [isFetching, setIsFetching] = useState(false);

	const fetchContext = useCallback(
		async (rawQuery: string): Promise<string | null> => {
			if (!isConnected) {
				debugLogger.debug("[RAG] MCP not connected, skipping context fetch.");
				return null;
			}

			const query = stripAnsi(rawQuery).trim();
			if (query.length < 3) return null;

			setIsFetching(true);
			debugLogger.debug(`[RAG] Collecting context for topic: "${query}"`);

			try {
				// collect_context 액션을 사용하여 고밀도 데이터 요청
				const result = await callTool("vault", {
					action: "collect_context",
					topic: query,
					maxDocs: 10,
					maxCharsPerDoc: 1000,
					memoryMode: "response_only",
				});

				if (result.isError) {
					debugLogger.warn(
						"[RAG] Context collection failed, falling back to basic search.",
					);
					// 에러 시 기존 search 액션으로 폴백 시도 가능 (생략)
					return null;
				}

				const text = result.content.find((c) => c.type === "text")?.text;
				if (!text) return null;

				const payload = JSON.parse(text);
				if (payload.documents?.length === 0) {
					debugLogger.debug("[RAG] No relevant documents found.");
					return null;
				}

				return formatAsContext(payload);
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
