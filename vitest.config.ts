import { resolve } from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
const root = import.meta.dirname;


export default defineConfig({
	test: {
		projects: [
			{
				plugins: [
					tsconfigPaths({
						projects: [resolve(root, "packages/server/tsconfig.json")],
					}),
				],
				resolve: {
					alias: {
						"@": resolve(root, "packages/server/src"),
						"@core": resolve(root, "packages/core/src"),
						"@sunub/core": resolve(root, "packages/core/src/index.ts"),
					},
				},
				test: {
					name: "server",
					root: resolve(root, "packages/server"),
					include: ["tests/**/*.{test,spec}.{ts,tsx}"],
					globals: true,
					environment: "node",
					hookTimeout: 60000,
				},
			},
			{
				plugins: [
					tsconfigPaths({
						projects: [resolve(root, "packages/cli/tsconfig.json")],
					}),
				],
				resolve: {
					alias: {
						"@cli": resolve(root, "packages/cli/src"),
						"@core": resolve(root, "packages/core/src"),
						"@": resolve(root, "packages/server/src"),
						"@sunub/core": resolve(root, "packages/core/src/index.ts"),
						"@sunub/obsidian-mcp-server": resolve(
							root,
							"packages/server/src/index.ts",
						),
					},
				},
				test: {
					name: "cli",
					root: resolve(root, "packages/cli"),
					include: ["tests/**/*.{test,spec}.{ts,tsx}"],
					globals: true,
					environment: "jsdom",
				},
			},
		],
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
