import { beforeEach, describe, expect, test } from "vitest";
import { ChunkBM25Index } from "../../src/shared/indexing/keyword-search/index";
import { stripJosa } from "../../src/shared/indexing/keyword-search/josa";

describe("stripJosa", () => {
	test.each([
		["임베딩을", "임베딩"],
		["서버가", "서버"],
		["서버에서", "서버"],
		["접근성과", "접근성"],
		["데이터베이스의", "데이터베이스"],
		["react를", "react"],
	])("%s → %s", (input, expected) => {
		expect(stripJosa(input)).toBe(expected);
	});

	test.each([
		"아이",
		"모델",
		"typescript",
		"브라우저",
		"2024",
	])("조사가 아니거나 어간이 2자 미만이면 그대로 둔다: %s", (input) => {
		expect(stripJosa(input)).toBe(input);
	});
});

function doc(filePath: string, body: string, title = "", tags: string[] = []) {
	return { filePath, title, tags, body };
}

describe("ChunkBM25Index", () => {
	let index: ChunkBM25Index;

	beforeEach(() => {
		index = new ChunkBM25Index();
	});

	const paths = (query: string) => index.search(query).map((h) => h.filePath);

	test("조사가 붙은 질의가 조사 없는 본문을 찾는다", () => {
		index.addDocument(doc("a", "임베딩 모델의 차원을 정한다."));
		index.addDocument(doc("b", "관계없는 문서."));

		expect(paths("임베딩을")).toEqual(["a"]);
		expect(paths("차원이")).toEqual(["a"]);
	});

	test("조사가 붙은 본문을 조사 없는 질의가 찾는다", () => {
		index.addDocument(doc("a", "서버에서 임베딩을 계산한다."));

		expect(paths("임베딩")).toEqual(["a"]);
		expect(paths("서버")).toEqual(["a"]);
	});

	test("조사가 붙은 본문과 조사가 다른 질의도 서로 찾는다", () => {
		index.addDocument(doc("a", "서버가 임베딩을 계산한다."));

		expect(paths("임베딩의")).toEqual(["a"]);
	});

	test("원형 토큰 그대로도 찾는다", () => {
		index.addDocument(doc("a", "서버가 임베딩을 계산한다."));

		expect(paths("임베딩을")).toEqual(["a"]);
	});

	test("같은 단어가 더 많이 나온 문서가 먼저 나온다", () => {
		index.addDocument(
			doc("once", "cache 는 한 번만 나온다. 나머지는 다른 이야기."),
		);
		index.addDocument(
			doc("many", "cache cache cache 를 쓴다. 나머지는 다른 이야기."),
		);

		expect(paths("cache")).toEqual(["many", "once"]);
	});

	test("같은 횟수라면 짧은 청크가 먼저 나온다", () => {
		const filler = "무관한 문장입니다. ".repeat(30);
		index.addDocument(doc("long", `lancedb ${filler}`));
		index.addDocument(doc("short", "lancedb 설명"));

		expect(paths("lancedb")[0]).toBe("short");
	});

	test("드문 단어가 흔한 단어보다 점수에 더 크게 기여한다", () => {
		for (let i = 0; i < 20; i++) {
			index.addDocument(doc(`common${i}`, "react 상태 관리 이야기"));
		}
		index.addDocument(doc("rare", "react fiber 재조정 이야기"));

		expect(paths("react fiber")[0]).toBe("rare");
	});

	test("제목이 질의와 같은 짧은 문서가 긴 문서보다 먼저 나온다", () => {
		const longBody = Array.from(
			{ length: 40 },
			(_, i) => `react 컴포넌트 ${i}번째 설명이다.`,
		).join("\n\n");
		index.addDocument(
			doc("long", `${longBody}\n\nfiber 는 한 번 나온다.`, "React 모음"),
		);
		index.addDocument(doc("title", "재조정 알고리즘 설명.", "React Fiber"));

		expect(paths("React Fiber")[0]).toBe("title");
	});

	test("문서 점수는 가장 잘 맞는 청크 하나를 기준으로 한다", () => {
		const filler = Array.from(
			{ length: 30 },
			(_, i) => `무관한 문단 ${i}. 다른 주제를 길게 설명한다.`,
		).join("\n\n");
		index.addDocument(
			doc("scattered", `redis ${filler}\n\n${filler}\n\ncluster ${filler}`),
		);
		index.addDocument(doc("together", "redis cluster 구성 방법"));

		expect(paths("redis cluster")[0]).toBe("together");
	});

	test("본문이 맞은 문서는 맞은 청크의 본문을 돌려준다", () => {
		const filler = Array.from(
			{ length: 30 },
			(_, i) => `무관한 문단 ${i}. 다른 주제를 길게 설명한다.`,
		).join("\n\n");
		index.addDocument(
			doc("a", `${filler}\n\nlibuv 는 이벤트 루프를 제공한다.\n\n${filler}`),
		);

		const [hit] = index.search("libuv");
		expect(hit?.chunk).toContain("libuv");
		expect(hit?.chunk?.length).toBeLessThan(1000);
	});

	test("제목이나 태그만 맞으면 청크는 비어 있다", () => {
		index.addDocument(
			doc("a", "본문에는 없는 내용.", "Weekly Standup", ["회의"]),
		);

		const [hit] = index.search("standup");
		expect(hit?.filePath).toBe("a");
		expect(hit?.chunk).toBeNull();
	});

	test("긴 본문은 여러 청크로 나뉘고 각 청크는 길이 한도를 넘지 않는다", () => {
		const body = Array.from(
			{ length: 60 },
			(_, i) => `문단 ${i}: ${"내용 ".repeat(40)}`,
		).join("\n\n");
		index.addDocument(doc("a", `${body}\n\n끝에만 있는 zebra 단어`));

		const [hit] = index.search("zebra");
		expect(hit?.chunk).toContain("zebra");
		expect(hit?.chunk?.length).toBeLessThan(1000);
	});

	test("한 문단이 한도보다 길어도 잘라서 색인한다", () => {
		const longLine = `${"가나다 ".repeat(1000)}희귀단어`;
		index.addDocument(doc("a", longLine));

		const [hit] = index.search("희귀단어");
		expect(hit?.filePath).toBe("a");
		expect(hit?.chunk?.length).toBeLessThan(1000);
	});

	test("base64 data URI는 색인하지 않는다", () => {
		index.addDocument(
			doc("a", "![img](data:image/png;base64,AAAAqwertyBBBB) 본문."),
		);

		expect(paths("qwertybbbb")).toEqual([]);
		expect(paths("본문")).toEqual(["a"]);
	});

	test("문서를 제거하면 더 이상 찾지 않는다", () => {
		index.addDocument(doc("a", "alpha 내용"));
		index.addDocument(doc("b", "alpha 다른 내용"));

		index.removeDocument("a");

		expect(paths("alpha")).toEqual(["b"]);
	});

	test("같은 문서를 다시 추가하면 이전 내용은 사라진다", () => {
		index.addDocument(doc("a", "old 내용"));
		index.addDocument(doc("a", "new 내용"));

		expect(paths("old")).toEqual([]);
		expect(paths("new")).toEqual(["a"]);
	});

	test("clear()는 모든 문서를 지운다", () => {
		index.addDocument(doc("a", "alpha"));

		index.clear();

		expect(paths("alpha")).toEqual([]);
	});

	test("빈 질의나 일치하는 단어가 없으면 빈 배열이다", () => {
		index.addDocument(doc("a", "alpha"));

		expect(index.search("")).toEqual([]);
		expect(index.search("   ")).toEqual([]);
		expect(index.search("zzz")).toEqual([]);
	});

	test("질의 토큰이 3개 이상이면 최소 일치 조건을 채워야 나온다", () => {
		index.addDocument(doc("a", "alpha 만 있다"));
		index.addDocument(doc("b", "alpha beta 가 있다"));

		expect(paths("alpha beta gamma")).toEqual(["b"]);
	});

	test("문장부호가 붙은 질의 토큰은 문장부호를 떼고 찾는다", () => {
		index.addDocument(doc("a", "LanceDB 인덱스를 다시 만든다."));

		expect(paths("LanceDB,")).toEqual(["a"]);
		expect(paths("(lancedb)?")).toEqual(["a"]);
	});

	test("문장부호가 들어간 태그와 파일명은 원형으로도 찾는다", () => {
		index.addDocument(doc("dir/my-note.md", "본문.", "Note", ["c++"]));

		expect(paths("c++")).toEqual(["dir/my-note.md"]);
		expect(paths("my-note")).toEqual(["dir/my-note.md"]);
	});

	test("중간에 문장부호가 있는 질의는 나뉜 조각이 모두 있는 청크를 찾는다", () => {
		index.addDocument(doc("both", "Next.js 15에서 동적 라우트를 쓴다."));
		index.addDocument(doc("onlyNext", "next step을 정한다."));

		expect(paths("Next.js")).toEqual(["both"]);
	});

	test("한 글자 조각은 나뉜 조각 일치에 쓰지 않는다", () => {
		index.addDocument(doc("noise", "i 라는 변수와 o 라는 변수."));

		expect(paths("I/O")).toEqual([]);
	});

	test("헤더 텍스트 전체로도 찾는다", () => {
		index.addDocument(
			doc("a", "# Introduction\n\n## Architecture Overview\n\n본문."),
		);

		expect(paths("architecture overview")).toEqual(["a"]);
	});
});
