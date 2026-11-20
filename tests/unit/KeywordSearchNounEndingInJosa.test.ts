import { describe, expect, test } from "vitest";
import { ChunkBM25Index } from "../../src/keyword-search/index";

function indexOf(...bodies: string[]) {
	const index = new ChunkBM25Index();
	bodies.forEach((body, i) => {
		index.addDocument({ filePath: `doc${i}`, title: "", tags: [], body });
	});
	return (query: string) => index.search(query).map((hit) => hit.filePath);
}

describe("조사처럼 보이는 글자로 끝나는 명사", () => {
	test("분포도로 질의하면 분포도에 조사가 붙은 본문도 찾는다", () => {
		const search = indexOf("분포도를 그려서 확인한다.", "관계없는 문서.");

		expect(search("분포도")).toEqual(["doc0"]);
	});

	test("결합도로 질의하면 결합도에 조사가 붙은 본문도 찾는다", () => {
		const search = indexOf("결합도가 높으면 수정이 어렵다.", "관계없는 문서.");

		expect(search("결합도")).toEqual(["doc0"]);
	});

	test("원형 그대로 쓴 본문은 조사가 붙은 본문보다 먼저 나온다", () => {
		const search = indexOf("분포도를 그려서 확인한다.", "분포도 그래프.");

		expect(search("분포도")).toEqual(["doc1", "doc0"]);
	});
});
