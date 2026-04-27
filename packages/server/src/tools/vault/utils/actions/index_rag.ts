import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import state from "@/config.js";
import { ragIndexer } from "@/utils/RAGIndexer.js";

export const triggerIndexing = async (): Promise<CallToolResult> => {
	const vaultPath = state.vaultPath;

	if (!vaultPath) {
		throw new Error("Vault path is not configured.");
	}

	try {
		// 전체 색인은 시간이 걸릴 수 있으므로 비동기로 실행하고 일단 시작됨을 알립니다.
		// 하지만 MCP 도구 응답 시간 제한이 있을 수 있으므로 상황에 따라 다르게 처리할 수 있습니다.
		// 여기서는 일단 직접 실행하되 진행 상황을 알리는 방향으로 작성합니다.
		await ragIndexer.indexAll(vaultPath);

		return {
			content: [
				{
					type: "text",
					text: `Successfully indexed all documents in vault: ${vaultPath}`,
				},
			],
		};
	} catch (error) {
		console.error("Full indexing failed:", error);
		throw error;
	}
};
