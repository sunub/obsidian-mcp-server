import { describe, expect, test } from "vitest";
import {
	extractDocumentLinks,
	extractImageLinks,
} from "../../src/utils/processor/LinkExtractor";

describe("LinkExtractor", () => {
	describe("extractImageLinks", () => {
		test("Obsidian 위키 이미지 링크(![[image.png]])를 추출한다", () => {
			const content = "Some text ![[photo.png]] and more ![[diagram.svg]]";
			const result = extractImageLinks(content);
			expect(result).toEqual(["photo.png", "diagram.svg"]);
		});

		test("Markdown 표준 이미지 링크(![alt](url))를 추출한다", () => {
			const content =
				"Here is ![alt text](images/photo.jpg) and ![](other.png)";
			const result = extractImageLinks(content);
			expect(result).toEqual(["images/photo.jpg", "other.png"]);
		});

		test("위키 링크와 Markdown 링크가 혼재된 문서를 처리한다", () => {
			const content =
				"![[wiki.png]] text ![md](standard.jpg) more ![[another.gif]]";
			const result = extractImageLinks(content);
			expect(result).toEqual(["wiki.png", "another.gif", "standard.jpg"]);
		});

		test("이미지 링크가 없으면 빈 배열을 반환한다", () => {
			const content = "No images here, just [[a document link]].";
			const result = extractImageLinks(content);
			expect(result).toEqual([]);
		});

		test("빈 문자열을 처리한다", () => {
			expect(extractImageLinks("")).toEqual([]);
		});

		test("경로가 포함된 이미지 링크를 추출한다", () => {
			const content = "![[attachments/sub folder/image.png]]";
			const result = extractImageLinks(content);
			expect(result).toEqual(["attachments/sub folder/image.png"]);
		});
	});

	describe("extractDocumentLinks", () => {
		test("기본 위키 문서 링크([[File]])를 추출한다", () => {
			const content = "Link to [[Note A]] and [[Note B]]";
			const result = extractDocumentLinks(content);
			expect(result).toEqual(["Note A", "Note B"]);
		});

		test("별칭이 포함된 링크([[File|Alias]])에서 파일명만 추출한다", () => {
			const content = "See [[RealFile|Display Name]] for more";
			const result = extractDocumentLinks(content);
			expect(result).toEqual(["RealFile"]);
		});

		test("앵커가 포함된 링크([[File#Header]])에서 파일명만 추출한다", () => {
			const content = "Refer to [[Document#Section 2]] here";
			const result = extractDocumentLinks(content);
			expect(result).toEqual(["Document"]);
		});

		test("별칭+앵커 조합([[File#Header|Alias]])에서 파일명만 추출한다", () => {
			const content = "Go to [[MyNote#Intro|click here]]";
			const result = extractDocumentLinks(content);
			expect(result).toEqual(["MyNote"]);
		});

		test("이미지 링크(![[...]])는 문서 링크로 추출하지 않는다", () => {
			const content = "Image ![[photo.png]] and doc link [[NoteX]]";
			const result = extractDocumentLinks(content);
			expect(result).toEqual(["NoteX"]);
		});

		test("문서 링크가 없으면 빈 배열을 반환한다", () => {
			const content = "Just plain text with no links.";
			expect(extractDocumentLinks(content)).toEqual([]);
		});

		test("빈 문자열을 처리한다", () => {
			expect(extractDocumentLinks("")).toEqual([]);
		});

		test("한 줄에 여러 링크가 있어도 모두 추출한다", () => {
			const content = "Links: [[A]], [[B]], [[C]]";
			const result = extractDocumentLinks(content);
			expect(result).toEqual(["A", "B", "C"]);
		});
	});
});
