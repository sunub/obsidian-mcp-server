import { useCallback } from "react";
import { debugLogger } from "../utils/debugLogger.js";
import type { CallToolFn, DispatchResult, McpToolResult } from "../types.js";
import { HELP_COMMAND_MARKER } from "../constants.js";

// ─── Helpers ────────────────────────────────────────────────

function extractText(result: McpToolResult): string {
	return result.content
		.filter((c) => c.type === "text" && c.text)
		.map((c) => c.text ?? "")
		.join("\n");
}

function extractFilenameFromArgs(args: string): string {
	const quoted =
		args.match(/[\u201C"]([^\u201D"]+)[\u201D"]/) ??
		args.match(/"([^"]+)"/) ??
		args.match(/\u300C([^\u300D]+)\u300D/);
	if (quoted?.[1]) {
		return quoted[1].trim();
	}
	return args;
}

// ─── Command → Tool Mapping ─────────────────────────────────

interface CommandMapping {
	tool: string;
	buildArgs: (args: string) => Record<string, unknown>;
	requiresArgs?: boolean;
	noArgsMessage?: string;
}

const COMMAND_MAP: Record<string, CommandMapping> = {
	"/search": {
		tool: "vault",
		requiresArgs: true,
		noArgsMessage: "사용법: /search <검색어>",
		buildArgs: (args) => ({
			action: "search",
			keyword: args,
			limit: 10,
			includeContent: true,
			compressionMode: "balanced",
		}),
	},
	"/read": {
		tool: "vault",
		requiresArgs: true,
		noArgsMessage:
			'사용법: /read <파일명>\n예: /read "브라우저의 교차 출처 리소스 공유(CORS).md"',
		buildArgs: (args) => ({
			action: "read",
			filename: extractFilenameFromArgs(args),
		}),
	},
	"/semantic": {
		tool: "vault",
		requiresArgs: true,
		noArgsMessage: "사용법: /semantic <검색 쿼리>",
		buildArgs: (args) => ({
			action: "search_vault_by_semantic",
			query: args,
			limit: 5,
		}),
	},
	"/stats": {
		tool: "vault",
		buildArgs: () => ({ action: "stats" }),
	},
	"/index": {
		tool: "vault",
		buildArgs: () => ({ action: "index_vault_to_vectordb" }),
	},
	"/context": {
		tool: "vault",
		requiresArgs: true,
		noArgsMessage: "사용법: /context <토픽>",
		buildArgs: (args) => ({
			action: "collect_context",
			topic: args,
			scope: "topic",
			maxDocs: 10,
			memoryMode: "response_only",
		}),
	},
};

// ─── /read Fallback (search when file not found) ────────────

async function handleReadFallback(
	args: string,
	callTool: CallToolFn,
): Promise<DispatchResult> {
	const filename = extractFilenameFromArgs(args);
	debugLogger.log(
		`[Dispatcher] Read failed, trying search fallback for: "${filename}"`,
	);

	try {
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
	} catch {
		// Fallback search failed — return generic message below
	}

	return {
		type: "tool_result",
		content: `"${filename}" 파일을 찾지 못했습니다.\n💡 /search ${filename} 으로 먼저 검색해보세요.`,
	};
}

// ─── Hook ───────────────────────────────────────────────────

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

			// ① Local actions — no MCP call needed
			switch (command) {
				case "/help":
					return { type: "local_action", content: HELP_COMMAND_MARKER };
				case "/clear":
					return { type: "local_action", content: "__CLEAR_HISTORY__" };
				case "/tools":
					return { type: "local_action", content: "__LIST_TOOLS__" };
			}

			// ② Lookup command in mapping table
			const mapping = COMMAND_MAP[command];
			if (!mapping) {
				return {
					type: "unknown_command",
					content: `알 수 없는 커맨드: ${command}\n/help 를 입력하여 사용 가능한 커맨드를 확인하세요.`,
				};
			}

			// ③ Validate required args
			if (mapping.requiresArgs && !args) {
				return {
					type: "tool_result",
					content: mapping.noArgsMessage ?? "인자가 필요합니다.",
				};
			}

			// ④ Build structured args & call tool
			const toolArgs = mapping.buildArgs(args);

			try {
				const result = await callTool(mapping.tool, toolArgs);

				if (result.isError) {
					if (command === "/read") {
						return handleReadFallback(args, callTool);
					}
					return {
						type: "tool_result",
						content: `실행 실패: ${extractText(result)}`,
					};
				}

				return {
					type: "tool_result",
					content: extractText(result) || "결과가 없습니다.",
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				debugLogger.error(`[Dispatcher] Tool call failed:`, msg);
				return {
					type: "tool_result",
					content: `도구 호출 오류: ${msg}`,
				};
			}
		},
		[],
	);

	return { handleDispatch };
}
