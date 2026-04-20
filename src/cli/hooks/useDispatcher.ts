import { useCallback } from "react";
import type { McpToolInfo } from "../services/McpClientService.js";
import type { CallToolFn, DispatchResult, McpToolResult } from "../types.js";
import { debugLogger } from "../utils/debugLogger.js";
import { HELP_COMMAND_MARKER } from "../constants.js";

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
	"/organize": {
		tool: "organize_attachments",
		requiresArgs: true,
		noArgsMessage: "사용법: /organize <검색키워드>",
		buildArgs: (args) => ({ keyword: args }),
	},
	"/genprop": {
		tool: "generate_property",
		requiresArgs: true,
		noArgsMessage: '사용법: /genprop <파일명>\n예: /genprop "my-post.md"',
		buildArgs: (args) => ({
			filename: extractFilenameFromArgs(args),
		}),
	},
};

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

function tryMatchDynamicTool(
	command: string,
	availableTools: McpToolInfo[],
): McpToolInfo | undefined {
	const toolName = command.slice(1);
	return availableTools.find((t) => t.name === toolName);
}

/**
 * 동적 도구 호출 시 인자를 빌드하는 전략:
 * 1. key=value 구문으로 파싱 시도
 * 2. 빈 결과이면 도구의 inputSchema에서 첫 번째 required string 파라미터를 찾아
 *    raw text 전체를 해당 파라미터 값으로 매핑
 */
function buildDynamicArgs(
	rawArgs: string,
	tool: McpToolInfo,
): Record<string, unknown> {
	if (!rawArgs) return {};

	// 1차: key=value 파싱
	const kvArgs = parseKeyValueArgs(rawArgs);
	if (Object.keys(kvArgs).length > 0) return kvArgs;

	// 2차: JSON 직접 파싱 시도
	if (rawArgs.startsWith("{")) {
		try {
			return JSON.parse(rawArgs) as Record<string, unknown>;
		} catch {
			// fall through
		}
	}

	// 3차: 스키마 기반 — 첫 번째 required string 파라미터에 전체 텍스트 할당
	const schema = tool.inputSchema;
	if (schema?.required?.length && schema.properties) {
		for (const paramName of schema.required) {
			const prop = schema.properties[paramName];
			if (prop?.type === "string") {
				debugLogger.log(
					`[Dispatcher] Schema-based arg mapping: "${paramName}" ← raw text`,
				);
				return { [paramName]: rawArgs };
			}
		}
	}

	// 최후 폴백: 일반적인 파라미터 이름에 매핑 시도
	const commonParamNames = [
		"filename",
		"keyword",
		"query",
		"sourcePath",
		"filePath",
		"name",
		"input",
		"text",
	];
	if (schema?.properties) {
		for (const name of commonParamNames) {
			if (name in schema.properties) {
				return { [name]: rawArgs };
			}
		}
	}

	// 어떤 매핑도 못 찾으면 raw text를 반환 (서버가 거부할 수 있음)
	return { input: rawArgs };
}

export interface UseDispatcherReturn {
	handleDispatch: (
		text: string,
		callTool: CallToolFn,
	) => Promise<DispatchResult>;
}

export function useDispatcher(
	availableTools: McpToolInfo[] = [],
): UseDispatcherReturn {
	const handleDispatch = useCallback(
		async (text: string, callTool: CallToolFn): Promise<DispatchResult> => {
			const trimmed = text.trim();
			const [command, ...argParts] = trimmed.split(/\s+/);
			const args = argParts.join(" ").trim();

			debugLogger.log(`[Dispatcher] Command: ${command}, Args: "${args}"`);

			switch (command) {
				case "/help":
					return { type: "local_action", content: HELP_COMMAND_MARKER };
				case "/clear":
					return { type: "local_action", content: "__CLEAR_HISTORY__" };
				case "/tools":
					return { type: "local_action", content: "__LIST_TOOLS__" };
			}

			const mapping = COMMAND_MAP[command];
			if (mapping) {
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

			const dynamicTool = tryMatchDynamicTool(command, availableTools);
			if (dynamicTool) {
				const toolArgs = buildDynamicArgs(args, dynamicTool);
				debugLogger.log(
					`[Dispatcher] Dynamic tool dispatch: ${dynamicTool.name}`,
					JSON.stringify(toolArgs).slice(0, 200),
				);
				return executeToolCall(
					command,
					dynamicTool.name,
					toolArgs,
					args,
					callTool,
				);
			}

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
