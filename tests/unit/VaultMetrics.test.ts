import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, test } from "vitest";
import { buildVaultResponseMetric } from "../../src/tools/vault/metrics.js";

function createTextResult(payload: unknown, isError = false): CallToolResult {
	return {
		isError,
		content: [{ type: "text", text: JSON.stringify(payload) }],
	} as unknown as CallToolResult;
}

describe("Vault response metrics", () => {
	test("extracts compression and doc_count for search action", () => {
		const result = createTextResult({
			query: "next.js",
			found: 2,
			documents: [{ filename: "a.md" }, { filename: "b.md" }],
			compression: {
				mode: "balanced",
				source_chars: 1200,
				output_chars: 850,
				estimated_tokens: 284,
				max_output_chars: 2500,
				truncated: true,
				expand_hint: "hint",
			},
		});

		const metric = buildVaultResponseMetric("search", result);
		expect(metric).not.toBeNull();
		expect(metric?.action).toBe("search");
		expect(metric?.mode).toBe("balanced");
		expect(metric?.estimated_tokens).toBe(284);
		expect(metric?.truncated).toBe(true);
		expect(metric?.doc_count).toBe(2);
	});

	test("infers single doc_count for read action without documents array", () => {
		const result = createTextResult({
			filename: "nextjs.md",
			content: "content",
			compression: {
				mode: "none",
				source_chars: 200,
				output_chars: 200,
				estimated_tokens: 67,
				max_output_chars: null,
				truncated: false,
				expand_hint: "hint",
			},
		});

		const metric = buildVaultResponseMetric("read", result);
		expect(metric).not.toBeNull();
		expect(metric?.doc_count).toBe(1);
		expect(metric?.mode).toBe("none");
	});

	test("extracts cache_hit for collect_context action", () => {
		const result = createTextResult({
			action: "collect_context",
			documents: [{ filename: "resume.md" }],
			cache: { hit: true },
			compression: {
				mode: "aggressive",
				source_chars: 1300,
				output_chars: 700,
				estimated_tokens: 234,
				max_output_chars: 2800,
				truncated: true,
				expand_hint: "hint",
			},
		});

		const metric = buildVaultResponseMetric("collect_context", result);
		expect(metric).not.toBeNull();
		expect(metric?.doc_count).toBe(1);
		expect(metric?.cache_hit).toBe(true);
	});

	test("returns null when compression metadata does not exist", () => {
		const result = createTextResult({
			vault_overview: { total_documents: 10 },
			documents: [],
		});
		const metric = buildVaultResponseMetric("list_all", result);
		expect(metric).toBeNull();
	});
});
