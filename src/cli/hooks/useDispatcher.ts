/**
 * useDispatcher — 슬래시 커맨드 라우터
 *
 * 사용자가 `/` 로 시작하는 커맨드를 입력하면
 * MCP 도구 호출 또는 로컬 액션으로 분기합니다.
 */

import { useCallback } from "react";
import { debugLogger } from "../utils/debugLogger.js";
import type { CallToolFn, DispatchResult, McpToolResult } from "../types.js";

/**
 * MCP 도구 응답에서 텍스트를 추출합니다.
 */
function extractText(result: McpToolResult): string {
  return result.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text ?? "")
    .join("\n");
}

/**
 * 자연어 문장에서 따옴표로 감싼 파일명을 추출합니다.
 * 예: '내가 작성한 "CORS와 SOP" 문서를 읽어줘' → 'CORS와 SOP'
 * 따옴표가 없으면 원본 인자를 그대로 반환합니다.
 */
function extractFilenameFromArgs(args: string): string {
  // 큰따옴표 또는 겹낫표(「」) 안의 텍스트 추출
  const quoted =
    args.match(/[""]([^""]+)[""]/) ??
    args.match(/"([^"]+)"/) ??
    args.match(/「([^」]+)」/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }
  return args;
}

const HELP_TEXT = `사용 가능한 커맨드:
  /search <keyword>   — Vault 키워드 검색
  /read <filename>    — 문서 읽기 (따옴표로 파일명 감싸기 권장)
  /semantic <query>   — 시맨틱(벡터) 검색
  /stats              — Vault 상태 정보
  /index              — 벡터 DB 인덱싱 실행
  /context <topic>    — 토픽 기반 컨텍스트 수집
  /tools              — 사용 가능한 MCP 도구 목록
  /clear              — 대화 히스토리 초기화
  /help               — 이 도움말 표시

💡 자연어 질문은 슬래시 없이 입력하면 RAG 기반으로 답변합니다.`;

export interface UseDispatcherReturn {
  handleDispatch: (
    text: string,
    callTool: CallToolFn,
  ) => Promise<DispatchResult>;
}

export function useDispatcher(): UseDispatcherReturn {
  const handleDispatch = useCallback(
    async (text: string, callTool: CallToolFn): Promise<DispatchResult> => {
      const trimmed = text.trim();
      const [command, ...argParts] = trimmed.split(/\s+/);
      const args = argParts.join(" ").trim();

      debugLogger.log(`[Dispatcher] Command: ${command}, Args: "${args}"`);

      switch (command) {
        case "/search": {
          if (!args) {
            return {
              type: "tool_result",
              content: "사용법: /search <검색어>",
            };
          }
          const result = await callTool("vault", {
            action: "search",
            keyword: args,
            limit: 10,
            includeContent: true,
            compressionMode: "balanced",
          });
          return {
            type: "tool_result",
            content: result.isError
              ? `검색 실패: ${extractText(result)}`
              : extractText(result) || "검색 결과가 없습니다.",
          };
        }

        case "/read": {
          if (!args) {
            return {
              type: "tool_result",
              content:
                '사용법: /read <파일명>\n예: /read "브라우저의 교차 출처 리소스 공유(CORS).md"',
            };
          }
          const filename = extractFilenameFromArgs(args);
          debugLogger.log(`[Dispatcher] Extracted filename: "${filename}"`);

          const result = await callTool("vault", {
            action: "read",
            filename,
          });

          if (result.isError) {
            // 파일을 찾지 못한 경우, 키워드 검색으로 폴백
            debugLogger.log(
              `[Dispatcher] Read failed, trying search fallback for: "${filename}"`,
            );
            const searchResult = await callTool("vault", {
              action: "search",
              keyword: filename,
              limit: 5,
              includeContent: false,
              compressionMode: "aggressive",
            });

            if (!searchResult.isError) {
              const searchText = extractText(searchResult);
              if (searchText && !searchText.includes("No results")) {
                return {
                  type: "tool_result",
                  content: `"${filename}" 파일을 찾지 못했습니다.\n\n유사한 문서:\n${searchText}\n\n💡 정확한 파일명으로 다시 시도하세요: /read "파일명.md"`,
                };
              }
            }

            return {
              type: "tool_result",
              content: `"${filename}" 파일을 찾지 못했습니다.\n💡 /search ${filename} 으로 먼저 검색해보세요.`,
            };
          }

          return {
            type: "tool_result",
            content: extractText(result) || "문서를 찾을 수 없습니다.",
          };
        }

        case "/semantic": {
          if (!args) {
            return {
              type: "tool_result",
              content: "사용법: /semantic <검색 쿼리>",
            };
          }
          const result = await callTool("vault", {
            action: "search_vault_by_semantic",
            query: args,
            limit: 5,
          });
          return {
            type: "tool_result",
            content: result.isError
              ? `시맨틱 검색 실패: ${extractText(result)}`
              : extractText(result) || "관련 문서를 찾을 수 없습니다.",
          };
        }

        case "/stats": {
          const result = await callTool("vault", {
            action: "stats",
          });
          return {
            type: "tool_result",
            content: result.isError
              ? `상태 조회 실패: ${extractText(result)}`
              : extractText(result),
          };
        }

        case "/index": {
          const result = await callTool("vault", {
            action: "index_vault_to_vectordb",
          });
          return {
            type: "tool_result",
            content: result.isError
              ? `인덱싱 실패: ${extractText(result)}`
              : extractText(result) || "벡터 DB 인덱싱이 완료되었습니다.",
          };
        }

        case "/context": {
          if (!args) {
            return {
              type: "tool_result",
              content: "사용법: /context <토픽>",
            };
          }
          const result = await callTool("vault", {
            action: "collect_context",
            topic: args,
            scope: "topic",
            maxDocs: 10,
            memoryMode: "response_only",
          });
          return {
            type: "tool_result",
            content: result.isError
              ? `컨텍스트 수집 실패: ${extractText(result)}`
              : extractText(result) || "관련 컨텍스트를 찾을 수 없습니다.",
          };
        }

        case "/help":
          return { type: "local_action", content: HELP_TEXT };

        case "/clear":
          return {
            type: "local_action",
            content: "__CLEAR_HISTORY__",
          };

        case "/tools":
          return {
            type: "local_action",
            content: "__LIST_TOOLS__",
          };

        default:
          return {
            type: "unknown_command",
            content: `알 수 없는 커맨드: ${command}\n/help 를 입력하여 사용 가능한 커맨드를 확인하세요.`,
          };
      }
    },
    [],
  );

  return { handleDispatch };
}
