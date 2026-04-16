import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { debugLogger } from "../utils/debugLogger.ts";
import ollama from "ollama";
import { useApp } from "ink";
import type { PendingItem, StreamingState, OllamaMessage } from "../types.ts";

/** ANSI 이스케이프 시퀀스 제거 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences intentionally matched
const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[A-Za-z0-9=><~]/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export interface LlmStreamState {
  pendingItem: PendingItem | null;
  streamingState: StreamingState;
  /** 하위 호환 computed property: `streamingState !== 'idle'` */
  isLoading: boolean;
  error: Error | null;
  sendMessage: (text: string, ragContext?: string | null) => Promise<void>;
  reset: () => void;
  /** 대화 히스토리 초기화 */
  clearHistory: () => void;
}

/**
 * Ollama SDK의 AbortableAsyncIterator를 활용하여
 * 안전하게 텍스트 청크를 전달하는 비동기 제너레이터입니다.
 * 멀티턴 대화를 위해 전체 messages 배열을 전송합니다.
 */
async function* generateOllamaStream(
  modelName: string,
  messages: OllamaMessage[],
) {
  const stream = await ollama.chat({
    model: modelName,
    messages,
    stream: true,
  });

  for await (const part of stream) {
    if (part.message?.content) {
      yield part.message.content;
    }
  }
}

export const useLlmStream = (): LlmStreamState => {
  const [pendingItem, setPendingItem] = useState<PendingItem | null>(null);
  const [streamingState, setStreamingState] = useState<StreamingState>("idle");
  const [error, setError] = useState<Error | null>(null);
  const { exit } = useApp();

  // 멀티턴 대화 히스토리 (시스템 + 사용자 + 어시스턴트 메시지)
  const conversationRef = useRef<OllamaMessage[]>([]);

  const isLoading = useMemo(
    () => streamingState !== "idle",
    [streamingState],
  );

  const modelName = process.env.OLLAMA_CHAT_MODEL || "llama3";

  // 사전 검증(Fail-fast): AppContainer에 마운트(초기화)될 때 Ollama 상태 점검
  useEffect(() => {
    async function bootSequenceCheck() {
      try {
        const { models } = await ollama.list();
        const hasModel = models.some(
          (m) =>
            m.name === modelName || m.name.startsWith(`${modelName}:`),
        );

        if (!hasModel) {
          const errMsg = `[오류] '${modelName}' 모델이 존재하지 않습니다. 새 터미널에서 'ollama pull ${modelName}' 명령을 실행하여 다운로드해 주세요.`;
          debugLogger.error("Boot Check Failed (Model missing):", errMsg);
          setError(new Error(errMsg));
          exit(new Error(errMsg));
        } else {
          debugLogger.log(
            `Boot Check Passed: Model ${modelName} is available.`,
          );
        }
      } catch (err) {
        const errMsg =
          "[오류] Ollama 서버에 연결할 수 없습니다. 애플리케이션 가동 전 백그라운드에 Ollama가 실행 중인지 점검해 주세요.";
        debugLogger.error("Boot Check Failed (Connection):", err);
        setError(new Error(errMsg));
        exit(new Error(errMsg));
      }
    }

    void bootSequenceCheck();
  }, [modelName, exit]);

  const sendMessage = useCallback(
    async (rawText: string, ragContext?: string | null) => {
      const text = stripAnsi(rawText).trim();
      setStreamingState("thinking");
      setPendingItem({ type: "assistant", content: "", isComplete: false });
      setError(null);
      debugLogger.log(`Starting to send message: ${text}`);

      try {
        // RAG 컨텍스트가 있으면 시스템 메시지로 삽입 (매 요청마다 최신화)
        const messagesForRequest: OllamaMessage[] = [];

        if (ragContext) {
          messagesForRequest.push({
            role: "system",
            content: ragContext,
          });
          debugLogger.log(
            `[LLM] RAG context injected (${ragContext.length} chars)`,
          );
        }

        // 기존 대화 히스토리 추가
        messagesForRequest.push(...conversationRef.current);

        // 현재 사용자 메시지 추가
        const userMessage: OllamaMessage = { role: "user", content: text };
        messagesForRequest.push(userMessage);

        // 대화 히스토리에 사용자 메시지 기록
        conversationRef.current.push(userMessage);

        debugLogger.log(
          `[LLM] Sending ${messagesForRequest.length} messages to Ollama`,
        );

        const streamGenerator = generateOllamaStream(
          modelName,
          messagesForRequest,
        );
        let isFirstChunk = true;
        let fullResponse = "";

        for await (const chunk of streamGenerator) {
          if (isFirstChunk) {
            setStreamingState("streaming");
            isFirstChunk = false;
          }
          fullResponse += chunk;
          setPendingItem((prev) =>
            prev ? { ...prev, content: prev.content + chunk } : null,
          );
        }

        // 어시스턴트 응답을 대화 히스토리에 기록
        conversationRef.current.push({
          role: "assistant",
          content: fullResponse,
        });

        // 스트림 완료: isComplete=true로 설정하여 AppContainer 이관 시그널 전달
        setPendingItem((prev) =>
          prev ? { ...prev, isComplete: true } : null,
        );

        debugLogger.log("Stream successfully completed.");
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        debugLogger.error(
          "Error in useLlmStream hook during streaming:",
          err,
        );

        setStreamingState("error");

        if (errorMessage.includes("not found")) {
          setError(
            new Error(
              `모델 호출 실패: 'ollama pull ${modelName}' 에러가 계속되면 모델명을 다시 한번 확인해 주세요.`,
            ),
          );
        } else {
          setError(new Error(`Ollama 통신 실패: ${errorMessage}`));
        }

        // 실패한 사용자 메시지를 히스토리에서 제거
        conversationRef.current.pop();

        setPendingItem(null);
      }
    },
    [modelName],
  );

  const reset = useCallback(() => {
    setPendingItem(null);
    setStreamingState("idle");
    setError(null);
  }, []);

  const clearHistory = useCallback(() => {
    conversationRef.current = [];
    debugLogger.log("[LLM] Conversation history cleared.");
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
