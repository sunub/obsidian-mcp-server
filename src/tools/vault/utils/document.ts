import type { DocumentIndex } from "../../../utils/processor/types.js";
import type { EnrichedDocument } from "../../../utils/VaultManger/types.js";
import type { VaultManager } from "../../../utils/VaultManger/VaultManager.js";

export async function getDocumentContent(
	vaultManager: VaultManager,
	filename: string,
	maxContentPreview?: number,
): Promise<Partial<EnrichedDocument>> {
	const doc = await vaultManager.getDocumentInfo(filename, {
		includeStats: true,
		maxContentPreview,
	});
	if (!doc) return {};
	return doc;
}

export function formatDocument(
	doc: DocumentIndex | EnrichedDocument,
	includeContent: boolean,
	excerptLength?: number,
) {
	const hasContentProperty =
		"content" in doc && typeof doc.content === "string";
	const sourceContentLength =
		"stats" in doc && doc.stats ? doc.stats.contentLength : doc.contentLength;
	const contentIsTruncated =
		!!excerptLength &&
		hasContentProperty &&
		typeof sourceContentLength === "number" &&
		sourceContentLength > doc.content.length;

	const createContentObject = () => {
		if (includeContent && hasContentProperty) {
			const excerpt =
				excerptLength && doc.content?.length > excerptLength
					? `${doc.content?.substring(0, excerptLength)}...`
					: doc.content;
			return {
				full: doc.content,
				excerpt,
			};
		}

		return {
			preview: "(Content not loaded)",
			note: "Full content available with includeContent=true",
		};
	};

	return {
		filename: doc.filePath.split("/").pop() || doc.filePath,
		fullPath: doc.filePath,
		metadata: {
			title: doc.frontmatter.title || "Untitled",
			tags: doc.frontmatter.tags || [],
		},
		stats:
			"stats" in doc && doc.stats
				? doc.stats
				: {
						contentLength: doc.contentLength,
						hasContent: hasContentProperty,
						wordCount: 0,
					},
		content: createContentObject(),
		content_is_truncated: contentIsTruncated,
	};
}
