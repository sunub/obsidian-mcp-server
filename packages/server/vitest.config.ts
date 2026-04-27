import { resolve } from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	root: import.meta.dirname,
	plugins: [
		tsconfigPaths({
			projects: [resolve(import.meta.dirname, "tsconfig.json")],
		}),
	],
	resolve: {
		alias: {
			"@": resolve(import.meta.dirname, "src"),
			"@core": resolve(import.meta.dirname, "../core/src"),
			"@sunub/core": resolve(import.meta.dirname, "../core/src/index.ts"),
		},
	},
	test: {
		name: "server",
		include: ["tests/**/*.{test,spec}.{ts,tsx}"],
		globals: true,
		environment: "node",
	},
});
