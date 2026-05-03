import { describe, expect, test } from "vitest";
import { createInputSubmissionContext } from "../../src/cli/ui/InputPrompt.js";

describe("input prompt submission context", () => {
	test("captures a pasted content snapshot independent from later buffer changes", () => {
		const pastedContent = {
			"[Pasted Text: 4 lines]": "alpha\nbeta",
		};

		const submissionContext = createInputSubmissionContext(pastedContent);
		pastedContent["[Pasted Text: 4 lines]"] = "mutated";
		pastedContent["[Pasted Text: 240 chars]"] = "new";

		expect(submissionContext.pastedContent).toEqual({
			"[Pasted Text: 4 lines]": "alpha\nbeta",
		});
	});
});
