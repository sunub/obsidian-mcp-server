import { describe, expect, test } from "vitest";
import type { ChunkMetadata } from "../../src/shared/indexing/VectorDB";
import type { DocumentIndex } from "../../src/shared/markdown/types";
import { fuseRrf } from "../../src/shared/search-backend/scoreFusion";

function documentOf(filePath: string): DocumentIndex {
	return {
		filePath,
		frontmatter: { title: filePath },
		contentLength: 10,
		mtime: 0,
		imageLinks: [],
		documentLinks: [],
	};
}

function chunkOf(filePath: string, chunkIndex: number): ChunkMetadata {
	return {
		id: `${filePath}_chunk_${chunkIndex}`,
		filePath,
		fileName: filePath,
		chunkIndex,
		content: `${filePath} ${chunkIndex}`,
		metadata: {
			title: filePath,
			date: "",
			tags: "",
			summary: "",
			slug: "",
			category: "any",
			completed: false,
		},
	};
}

function keywordHit(filePath: string, score: number) {
	return {
		document: documentOf(filePath),
		score,
		chunk: `${filePath} keyword body`,
	};
}

function denseHit(filePath: string, chunkIndex = 0) {
	return { filePath, similarity: 0.9, chunk: chunkOf(filePath, chunkIndex) };
}

const pathsOf = (results: { document: DocumentIndex }[]) =>
	results.map((result) => result.document.filePath);

describe("fuseRrf", () => {
	test("Dense 결과가 있으면 키워드 1위의 70% 미만 문서를 제외한다", () => {
		const results = fuseRrf({
			keywordHits: [
				keywordHit("top.md", 10),
				keywordHit("floor.md", 7),
				keywordHit("low.md", 6.9),
			],
			denseHits: [denseHit("dense.md")],
			resolveDocument: documentOf,
			limit: 10,
		});

		expect(pathsOf(results).sort()).toEqual(["dense.md", "floor.md", "top.md"]);
	});

	test("Dense 결과가 없으면 70% 미만 키워드 문서도 모두 돌려준다", () => {
		const results = fuseRrf({
			keywordHits: [keywordHit("top.md", 10), keywordHit("low.md", 1)],
			denseHits: [],
			resolveDocument: documentOf,
			limit: 10,
		});

		expect(pathsOf(results)).toEqual(["top.md", "low.md"]);
	});

	test("같은 문서의 청크는 순위 점수를 한 번만 더하고 모두 유지한다", () => {
		const results = fuseRrf({
			keywordHits: [],
			denseHits: [
				denseHit("a.md", 0),
				denseHit("a.md", 1),
				denseHit("b.md", 0),
			],
			resolveDocument: documentOf,
			limit: 10,
		});

		expect(results.map((result) => result.score)).toEqual([1 / 61, 1 / 62]);
		expect(results[0]?.finalScore).toBe(1 / 61);
		expect(results[0]?.matchedChunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
	});

	test("벡터 청크가 없는 키워드 문서는 키워드 청크를 채운다", () => {
		const [result] = fuseRrf({
			keywordHits: [keywordHit("a.md", 3)],
			denseHits: [],
			resolveDocument: documentOf,
			limit: 10,
		});

		expect(result?.matchedChunks).toMatchObject([
			{ chunkIndex: -1, content: "a.md keyword body" },
		]);
	});

	test("입력이 비어 있으면 빈 배열이다", () => {
		expect(
			fuseRrf({
				keywordHits: [],
				denseHits: [],
				resolveDocument: documentOf,
				limit: 5,
			}),
		).toEqual([]);
	});

	test("결과 수는 limit을 넘지 않는다", () => {
		const results = fuseRrf({
			keywordHits: [keywordHit("a.md", 2), keywordHit("b.md", 2)],
			denseHits: [denseHit("c.md")],
			resolveDocument: documentOf,
			limit: 2,
		});

		expect(results).toHaveLength(2);
	});
});
