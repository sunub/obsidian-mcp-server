import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { localEmbedder } from "../../src/shared/local-ai/Embedder";
import { localModelManager } from "../../src/shared/local-ai/LocalModelManager";
import { VaultManager } from "../../src/shared/vault-manager/VaultManager";

let tempDir: string | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	}
});

async function writeVault(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "vault-keyword-fallback-"));
	const filler = (count: number) => "무관한 문장입니다. ".repeat(count);
	await writeFile(join(dir, "a.md"), "serverless", "utf-8");
	await writeFile(join(dir, "b.md"), `serverless ${filler(8)}`, "utf-8");
	await writeFile(join(dir, "c.md"), `serverless ${filler(20)}`, "utf-8");
	await writeFile(join(dir, "d.md"), `serverless ${filler(40)}`, "utf-8");
	await writeFile(join(dir, "e.md"), `serverless ${filler(80)}`, "utf-8");
	return dir;
}

describe("VaultManager keyword fallback", () => {
	test("semantic 검색이 비어 있으면 키워드 결과를 점수 하한 없이 모두 돌려준다", async () => {
		tempDir = await writeVault();
		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(true);
		vi.spyOn(localModelManager, "withEmbedder").mockImplementation(
			async (_softDeadlineMs, callback) => callback(false),
		);

		const manager = new VaultManager(tempDir);
		const result = await manager.hybridSearch("serverless", 10);

		expect(result.results).toHaveLength(5);
		expect(result.search_status.reason).toBe("semantic_unavailable");
	});

	test("로컬 모델이 없으면 검색할 때마다 같은 상태를 알려준다", async () => {
		tempDir = await writeVault();
		vi.spyOn(localEmbedder, "checkModelPresence").mockResolvedValue(false);

		const manager = new VaultManager(tempDir);
		const first = await manager.hybridSearch("serverless", 10);
		const second = await manager.hybridSearch("serverless", 10);

		expect(first.search_status).toEqual({
			mode: "keyword",
			reason: "models_missing",
			setup_command: "npx @sunub/obsidian-mcp-server setup",
		});
		expect(second.search_status).toEqual(first.search_status);
	});
});
