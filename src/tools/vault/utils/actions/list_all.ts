import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VaultManager } from "../../../../utils/VaultManger/VaultManager.js";
import type { ObsidianContentQueryParams } from "../../params.js";
import { formatDocument, getDocumentContent } from "../document.js";

export async function listAllDocuments(
	vaultManager: VaultManager,
	params: ObsidianContentQueryParams,
): Promise<CallToolResult> {
	await vaultManager.initialize();
	const allDocuments = await vaultManager.getAllDocuments();
	const limitedDocs = allDocuments.slice(0, params.limit || 50);

	if (params.quiet) {
		return {
			isError: false,
			content: [
				{
					type: "text",
					text: JSON.stringify({
						total_documents: allDocuments.length,
						filenames: allDocuments.map(
							(doc) => doc.filePath.split("/").pop() || doc.filePath,
						),
					}),
				},
			],
		};
	}

	const documentsOverview = await Promise.all(
		limitedDocs.map(async (doc) => {
			if (params.includeContent) {
				const fullDoc = await getDocumentContent(
					vaultManager,
					doc.filePath,
					200,
				);
				return formatDocument({ ...doc, ...fullDoc }, true, 200);
			}
			return formatDocument(doc, false);
		}),
	);

	return {
		isError: false,
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						vault_overview: {
							total_documents: allDocuments.length,
							showing: limitedDocs.length,
						},
						documents: documentsOverview,
					},
					null,
					2,
				),
			},
		],
	};
}
