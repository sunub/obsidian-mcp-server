import { describe, expect, test } from "vitest";
import { ChunkBM25Index } from "../../src/keyword-search/index";

const VOCABULARY = Array.from({ length: 60 }, (_, i) => `word${i}`).concat([
	"서버가",
	"임베딩을",
	"캐시는",
	"분포도",
]);

function randomGenerator(seed: number) {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

function makeDocument(random: () => number, id: number) {
	const paragraphs = Array.from({ length: 6 + Math.floor(random() * 4) }, () =>
		Array.from(
			{ length: 30 + Math.floor(random() * 40) },
			() => VOCABULARY[Math.floor(random() * VOCABULARY.length)],
		).join(" "),
	);
	return {
		filePath: `/vault/doc${id}.md`,
		title: `title ${VOCABULARY[id % VOCABULARY.length]}`,
		tags: [],
		body: paragraphs.join("\n\n"),
	};
}

const QUERIES = [
	"word1",
	"word2 word3",
	"임베딩",
	"서버 캐시",
	"분포도를",
	"word10 word20 word30",
	"title word5",
];

function snapshot(index: ChunkBM25Index, query: string) {
	return new Map(
		index
			.search(query)
			.map((hit) => [hit.filePath, [hit.score, hit.chunk]] as const),
	);
}

describe("ChunkBM25Index 추가·갱신·삭제 반복", () => {
	test("압축이 일어날 만큼 갱신과 삭제를 반복해도 새로 만든 색인과 같은 결과를 낸다", () => {
		const random = randomGenerator(7);
		const live = new Map<string, ReturnType<typeof makeDocument>>();
		const churned = new ChunkBM25Index();
		for (let id = 0; id < 300; id++) {
			const doc = makeDocument(random, id);
			live.set(doc.filePath, doc);
			churned.addDocument(doc);
		}
		for (let step = 0; step < 600; step++) {
			const id = Math.floor(random() * 340);
			const filePath = `/vault/doc${id}.md`;
			if (random() < 0.25) {
				churned.removeDocument(filePath);
				live.delete(filePath);
				continue;
			}
			const doc = makeDocument(random, id);
			live.set(filePath, doc);
			churned.addDocument(doc);
		}

		const fresh = new ChunkBM25Index();
		for (const doc of live.values()) fresh.addDocument(doc);

		for (const query of QUERIES) {
			const actual = snapshot(churned, query);
			const expected = snapshot(fresh, query);
			expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
			for (const [filePath, [score, chunk]] of expected) {
				const [actualScore, actualChunk] = actual.get(filePath) ?? [];
				expect(actualScore).toBeCloseTo(score as number, 9);
				expect(actualChunk).toBe(chunk);
			}
		}
	});

	test("삭제한 문서는 압축 뒤에도 검색되지 않고 다시 추가하면 검색된다", () => {
		const random = randomGenerator(11);
		const index = new ChunkBM25Index();
		for (let id = 0; id < 200; id++)
			index.addDocument(makeDocument(random, id));
		index.addDocument({
			filePath: "/vault/unique.md",
			title: "",
			tags: [],
			body: "zebraunique 단어",
		});
		expect(index.search("zebraunique").map((h) => h.filePath)).toEqual([
			"/vault/unique.md",
		]);

		index.removeDocument("/vault/unique.md");
		for (let round = 0; round < 8; round++) {
			for (let id = 0; id < 200; id++)
				index.addDocument(makeDocument(random, id));
		}

		expect(index.search("zebraunique")).toEqual([]);
		index.addDocument({
			filePath: "/vault/unique.md",
			title: "",
			tags: [],
			body: "zebraunique 단어",
		});
		expect(index.search("zebraunique").map((h) => h.filePath)).toEqual([
			"/vault/unique.md",
		]);
	});

	test("모든 문서를 지운 뒤에는 빈 결과를 내고 다시 채울 수 있다", () => {
		const random = randomGenerator(3);
		const index = new ChunkBM25Index();
		for (let id = 0; id < 150; id++)
			index.addDocument(makeDocument(random, id));
		for (let id = 0; id < 150; id++) index.removeDocument(`/vault/doc${id}.md`);

		expect(index.search("word1")).toEqual([]);
		index.addDocument(makeDocument(random, 1));
		expect(index.search("word1").length).toBeGreaterThanOrEqual(0);
	});
});
