import { useCallback } from "react";
import type { McpToolInfo } from "../services/McpClientService.js";
import type { CallToolFn, DispatchResult, McpToolResult } from "../types.js";
import { debugLogger } from "../utils/debugLogger.js";
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

/**
 * CLI 인자 문자열을 key=value 쌍으로 파싱.
 * 예: 'keyword="test" quiet=true' → { keyword: "test", quiet: "true" }
 * key=value가 아닌 토큰은 무시.
 */
function parseKeyValueArgs(args: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const regex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(args)) !== null) {
		const key = match[1];
		const value = match[2] ?? match[3] ?? match[4];
		// boolean / number coercion
		if (value === "true") result[key] = true;
		else if (value === "false") result[key] = false;
		else if (/^\d+$/.test(value)) result[key] = Number(value);
		else result[key] = value;
	}
	return result;
}

// ─── Command Mapping (UX shortcuts → MCP tool calls) ────────

interface CommandMapping {
	tool: string;
	buildArgs: (args: string) => Record<string, unknown>;
	requiresArgs?: boolean;
	noArgsMessage?: string;
}

/**
 * 슬래시 커맨드 → MCP 도구 매핑 테이블.
 *
 * `tool` 값은 MCP 서버가 동적으로 등록한 도구 이름과 일치해야 합니다.
 * 디스패치 시 실제 toolRegistry에 존재하는지 검증합니다.
 */
const COMMAND_MAP: Record<string, CommandMapping> = {
	// ── vault tool actions ──
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
	// ── organize_attachments tool ──
	"/organize": {
		tool: "organize_attachments",
		requiresArgs: true,
		noArgsMessage: "사용법: /organize <검색키워드>",
		buildArgs: (args) => ({ keyword: args }),
	},
	// ── generate_property tool ──
	"/genprop": {
		tool: "generate_property",
		requiresArgs: true,
		noArgsMessage: '사용법: /genprop <파일명>\n예: /genprop "my-post.md"',
		buildArgs: (args) => ({
			filename: extractFilenameFromArgs(args),
		}),
	},
};

// ─── Read fallback ──────────────────────────────────────────

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

// ─── Tool existence check ───────────────────────────────────

function isToolAvailable(
	toolName: string,
	availableTools: McpToolInfo[],
): boolean {
	return availableTools.some((t) => t.name === toolName);
}

function buildAvailableToolsHint(availableTools: McpToolInfo[]): string {
	if (availableTools.length === 0) return "등록된 도구가 없습니다.";
	return availableTools.map((t) => `  • ${t.name}`).join("\n");
}

// ─── Dynamic tool dispatch (for tools not in COMMAND_MAP) ───

function tryMatchDynamicTool(
	command: string,
	availableTools: McpToolInfo[],
): McpToolInfo | undefined {
	// /tool_name → "tool_name"
	const toolName = command.slice(1);
	return availableTools.find((t) => t.name === toolName);
}

// ─── Hook ───────────────────────────────────────────────────

export interface UseDispatcherReturn {
	handleDispatch: (
		text: string,
		callTool: CallToolFn,
	) => Promise<DispatchResult>;
}

/**
 * 슬래시 커맨드 디스패처.
 *
 * @param availableTools - MCP 서버에서 동적으로 등록된 도구 목록.
 *   COMMAND_MAP의 도구 참조를 런타임에 검증하고,
 *   COMMAND_MAP에 없는 도구도 /<tool_name> 형태로 직접 호출 가능.
 */
export function useDispatcher(
	availableTools: McpToolInfo[] = [],
): UseDispatcherReturn {
	const handleDispatch = useCallback(
		async (text: string, callTool: CallToolFn): Promise<DispatchResult> => {
			const trimmed = text.trim();
			const [command, ...argParts] = trimmed.split(/\s+/);
			const args = argParts.join(" ").trim();

			debugLogger.log(`[Dispatcher] Command: ${command}, Args: "${args}"`);

			// ── Local actions (no MCP call) ──
			switch (command) {
				case "/help":
					return { type: "local_action", content: HELP_COMMAND_MARKER };
				case "/clear":
					return { type: "local_action", content: "__CLEAR_HISTORY__" };
				case "/tools":
					return { type: "local_action", content: "__LIST_TOOLS__" };
			}

			// ── COMMAND_MAP: curated slash command shortcuts ──
			const mapping = COMMAND_MAP[command];
			if (mapping) {
				// 도구가 실제 레지스트리에 존재하는지 검증
				if (
					availableTools.length > 0 &&
					!isToolAvailable(mapping.tool, availableTools)
				) {
					return {
						type: "tool_result",
						content:
							`도구 "${mapping.tool}"이(가) 현재 연결된 MCP 서버에 등록되어 있지 않습니다.\n\n` +
							`사용 가능한 도구:\n${buildAvailableToolsHint(availableTools)}`,
					};
				}

				if (mapping.requiresArgs && !args) {
					return {
						type: "tool_result",
						content: mapping.noArgsMessage ?? "인자가 필요합니다.",
					};
				}

				const toolArgs = mapping.buildArgs(args);
				return executeToolCall(command, mapping.tool, toolArgs, args, callTool);
			}

			// ── Dynamic fallthrough: /<tool_name> key=value ... ──
			const dynamicTool = tryMatchDynamicTool(command, availableTools);
			if (dynamicTool) {
				const toolArgs = args
					? parseKeyValueArgs(args)
					: {};
				debugLogger.log(
					`[Dispatcher] Dynamic tool dispatch: ${dynamicTool.name}`,
				);
				return executeToolCall(
					command,
					dynamicTool.name,
					toolArgs,
					args,
					callTool,
				);
			}

			// ── Unknown command ──
			const hint =
				availableTools.length > 0
					? `\n\n사용 가능한 도구 (/<tool_name> 형태로 직접 호출 가능):\n${buildAvailableToolsHint(availableTools)}`
					: "";
			return {
				type: "unknown_command",
				content: `알 수 없는 커맨드: ${command}\n/help 를 입력하여 사용 가능한 커맨드를 확인하세요.${hint}`,
			};
		},
		[availableTools],
	);

	return { handleDispatch };
}

// ─── Shared tool execution ──────────────────────────────────

async function executeToolCall(
	command: string,
	toolName: string,
	toolArgs: Record<string, unknown>,
	rawArgs: string,
	callTool: CallToolFn,
): Promise<DispatchResult> {
	try {
		const result = await callTool(toolName, toolArgs);

		if (result.isError) {
			if (command === "/read") {
				return handleReadFallback(rawArgs, callTool);
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
}
