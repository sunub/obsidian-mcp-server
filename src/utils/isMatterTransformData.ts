import type { MatterTransformData } from "./processor/types.js";

export function isMatterTransformData(
	obj: unknown,
): obj is MatterTransformData {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"frontmatter" in obj &&
		"contentLength" in obj &&
		"hasContent" in obj &&
		"content" in obj &&
		typeof (obj as MatterTransformData).frontmatter === "object" &&
		typeof (obj as MatterTransformData).contentLength === "number" &&
		typeof (obj as MatterTransformData).hasContent === "boolean" &&
		typeof (obj as MatterTransformData).content === "string"
	);
}
