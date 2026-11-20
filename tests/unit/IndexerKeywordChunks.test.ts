import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Indexer } from "../../src/utils/Indexer";
import { Semaphore } from "../../src/utils/semaphore";

const TEST_DIR = path.join(process.cwd(), "test-vault-indexer-chunks");

async function writeDoc(filename: string, title: string, body: string) {
	const filePath = path.join(TEST_DIR, filename);
	await fs.writeFile(filePath, `---\ntitle: ${title}\n---\n\n${body}`);
	return filePath;
}

describe("Indexer.searchWithChunks", () => {
	beforeAll(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	test("본문이 맞은 문서에는 맞은 청크가 붙는다", async () => {
		const filePath = await writeDoc(
			"loop.md",
			"메모",
			"서론.\n\n이벤트 루프는 비동기 작업을 처리한다.\n\n맺음말.",
		);
		const indexer = new Indexer();
		await indexer.build([filePath], new Semaphore(4));

		const [hit] = indexer.searchWithChunks("이벤트 루프가");

		expect(hit?.document.filePath).toBe(filePath);
		expect(hit?.chunk).toContain("이벤트 루프");
	});

	test("점수가 1위의 비율보다 낮은 결과는 최소 비율을 주면 뺀다", async () => {
		const strong = await writeDoc(
			"strong.md",
			"serverless optimization",
			"serverless optimization 전략.",
		);
		const weak = await writeDoc(
			"weak.md",
			"기타",
			`${"무관한 문장입니다. ".repeat(30)} serverless`,
		);
		const indexer = new Indexer();
		await indexer.build([strong, weak], new Semaphore(4));

		const all = indexer.searchWithChunks("serverless optimization");
		const strict = indexer.searchWithChunks("serverless optimization", 0.7);

		expect(all.map((hit) => hit.document.filePath)).toEqual([strong, weak]);
		expect(strict.map((hit) => hit.document.filePath)).toEqual([strong]);
	});

	test("search()는 최소 비율 없이 모든 결과를 돌려준다", async () => {
		const strong = await writeDoc("s.md", "alpha beta", "alpha beta");
		const weak = await writeDoc(
			"w.md",
			"기타",
			`${"무관한 문장입니다. ".repeat(30)} alpha`,
		);
		const indexer = new Indexer();
		await indexer.build([strong, weak], new Semaphore(4));

		expect(indexer.search("alpha beta")).toHaveLength(2);
	});
});
