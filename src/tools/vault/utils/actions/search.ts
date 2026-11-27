import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
	HybridSearchResult,
	VaultManager,
} from "@shared/vault-manager/VaultManager.js";
import type { ObsidianContentQueryParams } from "../../params.js";
import { createSnippet } from "../snippet.js";

const DEFAULT_LIMIT = 10;
const READ_HINT =
	"Read a note with action='read' and filename set to its path.";

function jsonResult(payload: unknown): CallToolResult {
	return {
		isError: false,
		content: [{ type: "text", text: JSON.stringify(payload) }],
	};
}

function toCandidate(
	vaultManager: VaultManager,
	query: string,
	{ document, matchedChunks, keywordText }: HybridSearchResult,
) {
	const snippet = createSnippet(query, [
		...matchedChunks.map((chunk) => chunk.content),
		keywordText ?? "",
	]);
	return {
		path: vaultManager.toRelativePath(document.filePath),
		title: document.frontmatter.title,
		tags: (document.frontmatter.tags ?? []).filter(Boolean),
		...(snippet ? { snippet } : {}),
	};
}

export async function searchDocuments(
	vaultManager: VaultManager,
	params: ObsidianContentQueryParams,
): Promise<CallToolResult> {
	await vaultManager.initialize();
	const query = params.keyword ?? "";

	const { results, search_status } = await vaultManager.hybridSearch(
		query,
		params.limit ?? DEFAULT_LIMIT,
	);

	if (params.quiet) {
		return jsonResult({
			found: results.length,
			search_status,
			filenames: results.map(
				(result) =>
					result.document.filePath.split("/").pop() || result.document.filePath,
			),
		});
	}

	const documents = results.map((result) =>
		toCandidate(vaultManager, query, result),
	);

	return jsonResult({
		query,
		search_status,
		found: documents.length,
		documents,
		...(documents.length > 0 ? { hint: READ_HINT } : {}),
	});
}
