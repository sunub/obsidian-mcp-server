import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { debugLogger } from "../utils/debugLogger.js";
import type { PendingItem, StreamingState, OllamaMessage } from "../types.js";
import state from "../../config.js";

const ANSI_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex:터미널 입력을 파싱하기 위한 정규식입니다.
  /[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[A-Za-z0-9=><~]/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export interface LlmStreamState {
  pendingItem: PendingItem | null;
  streamingState: StreamingState;
  isLoading: boolean;
  error: Error | null;
  sendMessage: (text: string, ragContext?: string | null) => Promise<void>;
  reset: () => void;
  clearHistory: () => void;
}

async function* generateLLMStream(messages: OllamaMessage[]) {
  const url = `${state.llmApiUrl.replace(/\/$/, "")}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: state.llmChatModel,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API Error (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response body is null");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const cleanedLine = line.replace(/^data: /, "").trim();
      if (!cleanedLine || cleanedLine === "[DONE]") continue;

      try {
        const parsed = JSON.parse(cleanedLine);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch (_e) {
        // partial JSON or noise
      }
    }
  }
}

export const useLlmStream = (): LlmStreamState => {
  const [pendingItem, setPendingItem] = useState<PendingItem | null>(null);
  const [streamingState, setStreamingState] = useState<StreamingState>("idle");
  const [error, setError] = useState<Error | null>(null);

  const conversationRef = useRef<OllamaMessage[]>([]);
  const isLoading = useMemo(() => streamingState !== "idle", [streamingState]);

  // 부팅 시 연결 확인
  useEffect(() => {
    async function bootCheck() {
      const url = `${state.llmApiUrl.replace(/\/$/, "")}/v1/models`;
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("API Check Failed");
        debugLogger.log(`[CLI] LLM Server verified at ${state.llmApiUrl}`);
      } catch (_err) {
        debugLogger.warn(
          `[CLI] Could not reach LLM Server at ${state.llmApiUrl}`,
        );
        // 8080 포트가 필수가 아닐 수도 있으므로 즉시 종료는 하지 않음
      }
    }
    void bootCheck();
  }, []);

  const sendMessage = useCallback(
    async (rawText: string, ragContext?: string | null) => {
      const text = stripAnsi(rawText).trim();
      setStreamingState("thinking");
      setPendingItem({ type: "assistant", content: "", isComplete: false });
      setError(null);

      try {
        const messagesForRequest: OllamaMessage[] = [];

        if (ragContext) {
          messagesForRequest.push({
            role: "system",
            content: ragContext,
          });
        }

        messagesForRequest.push(...conversationRef.current);
        const userMessage: OllamaMessage = { role: "user", content: text };
        messagesForRequest.push(userMessage);
        conversationRef.current.push(userMessage);

        const stream = generateLLMStream(messagesForRequest);
        let isFirstChunk = true;
        let fullResponse = "";

        for await (const chunk of stream) {
          if (isFirstChunk) {
            setStreamingState("streaming");
            isFirstChunk = false;
          }
          fullResponse += chunk;
          setPendingItem((prev) =>
            prev ? { ...prev, content: prev.content + chunk } : null,
          );
        }

        conversationRef.current.push({
          role: "assistant",
          content: fullResponse,
        });

        setPendingItem((prev) => (prev ? { ...prev, isComplete: true } : null));
      } catch (err: unknown) {
        debugLogger.error("Stream Error:", err);
        setStreamingState("error");
        const message = err instanceof Error ? err.message : String(err);
        setError(new Error(`LLM 통신 실패: ${message}`));
        conversationRef.current.pop();
        setPendingItem(null);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setPendingItem(null);
    setStreamingState("idle");
    setError(null);
  }, []);

  const clearHistory = useCallback(() => {
    conversationRef.current = [];
  }, []);

  return {
    pendingItem,
    streamingState,
    isLoading,
    error,
    sendMessage,
    reset,
    clearHistory,
  };
};
