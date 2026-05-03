import { describe, expect, it } from "vitest";
import { __bootLogoTestUtils } from "../../src/cli/utils/bootLogo.js";

describe("bootLogo helpers", () => {
	it("detects kitty-compatible boot logo terminals", () => {
		expect(
			__bootLogoTestUtils.supportsKittyBootLogo({
				TERM_PROGRAM: "ghostty",
			} as NodeJS.ProcessEnv),
		).toBe(true);
		expect(
			__bootLogoTestUtils.supportsKittyBootLogo({
				TERM_PROGRAM: "WezTerm",
			} as NodeJS.ProcessEnv),
		).toBe(true);
		expect(
			__bootLogoTestUtils.supportsKittyBootLogo({
				TERM_PROGRAM: "iTerm.app",
			} as NodeJS.ProcessEnv),
		).toBe(false);
	});

	it("chunks base64 payloads at kitty-safe boundaries", () => {
		const chunks = __bootLogoTestUtils.chunkBase64Payload(
			"a".repeat(9000),
			4096,
		);

		expect(chunks).toHaveLength(3);
		expect(chunks[0]).toHaveLength(4096);
		expect(chunks[1]).toHaveLength(4096);
		expect(chunks[2]).toHaveLength(808);
	});
});
