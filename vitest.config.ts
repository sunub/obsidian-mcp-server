import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: ["packages/*/vitest.config.ts"],
		coverage: {
			reporter: ["text", "json-summary", "json", "html", "lcovonly"],
			thresholds: {
				lines: 60,
				branches: 60,
				functions: 63,
				statements: 60,
			},
		},
	},
});
