import { describe, expect, test } from "vitest";
import {
	buildExpandedPasteInfo,
	calculateTransformationsForLine,
	calculateTransformedLine,
} from "../../src/cli/key/textBuffer/textBuffer.js";
import { parseInputForHighlighting } from "../../src/cli/utils/highlights.js";

describe("text buffer paste placeholders", () => {
	test("builds expansion metadata from placeholder position", () => {
		const line = "before [Pasted Text: 4 lines] after";
		const [transformation] = calculateTransformationsForLine(line);
		const placeholderId = transformation.id;

		expect(placeholderId).toBeDefined();

		const expandedPaste = buildExpandedPasteInfo(line, 3, transformation, {
			[placeholderId ?? line]: "alpha\nbeta",
		});

		expect(expandedPaste).toEqual({
			id: transformation.id,
			startLine: 3,
			lineCount: 2,
			prefix: "before ",
			suffix: " after",
		});
	});

	test("attaches expanded paste content only for the active expanded line", () => {
		const line = "[Pasted Text: 4 lines]";
		const [collapsedTransformation] = calculateTransformationsForLine(line, {
			[line]: "alpha\nbeta",
		});
		const [expandedTransformation] = calculateTransformationsForLine(
			line,
			{ [line]: "alpha\nbeta" },
			{
				id: line,
				startLine: 0,
				lineCount: 2,
				prefix: "",
				suffix: "",
			},
			0,
		);

		expect(collapsedTransformation.expandedText).toBeUndefined();
		expect(expandedTransformation.expandedText).toBe("alpha\nbeta");
	});

	test("expands transformed line content for active paste previews", () => {
		const line = "before [Pasted Text: 4 lines] after";
		const transformations = calculateTransformationsForLine(
			line,
			{ "[Pasted Text: 4 lines]": "alpha\nbeta" },
			{
				id: "[Pasted Text: 4 lines]",
				startLine: 0,
				lineCount: 2,
				prefix: "before ",
				suffix: " after",
			},
			0,
		);

		const transformed = calculateTransformedLine(
			line,
			0,
			[0, 0],
			transformations,
			{
				id: "[Pasted Text: 4 lines]",
				startLine: 0,
				lineCount: 2,
				prefix: "before ",
				suffix: " after",
			},
		);

		expect(transformed.transformedLine).toBe("before alpha\nbeta after");
		expect(transformed.transformedToLogMap.at(-1)).toBe(line.length);
	});

	test("classifies paste placeholders as paste tokens", () => {
		const line = "[Pasted Text: 240 chars]";
		const transformations = calculateTransformationsForLine(line);
		const tokens = parseInputForHighlighting(line, 0, transformations, 0);

		expect(tokens).toEqual([{ text: line, type: "paste" }]);
	});
});
