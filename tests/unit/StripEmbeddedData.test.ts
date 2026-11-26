import { describe, expect, test } from "vitest";
import { stripEmbeddedData } from "../../src/shared/markdown/stripEmbeddedData";

const PAYLOAD = "iVBORw0KGgoAAAANSUhEUgAA".repeat(200);

describe("stripEmbeddedData", () => {
	test("Markdown 이미지의 base64 data URI를 지우고 대체 텍스트는 남긴다", () => {
		const text = `앞 문장\n![아키텍처](data:image/png;base64,${PAYLOAD})\n뒤 문장`;

		expect(stripEmbeddedData(text)).toBe("앞 문장\n![아키텍처]()\n뒤 문장");
	});

	test("제목 줄 안의 이미지도 지워 제목 텍스트가 오염되지 않는다", () => {
		const text = `### ![](data:image/png;base64,${PAYLOAD}) 성능 개선`;

		expect(stripEmbeddedData(text)).toBe("### ![]() 성능 개선");
	});

	test("HTML img 태그의 data URI도 지운다", () => {
		const text = `<img src="data:image/bmp;base64,${PAYLOAD}" alt="x">`;

		expect(stripEmbeddedData(text)).toBe('<img src="" alt="x">');
	});

	test("data URI가 없는 본문과 일반 링크는 그대로 둔다", () => {
		const text =
			"# 제목\n본문 data: 라는 단어\n![](images/a.png)\n[링크](https://example.com/data:image)";

		expect(stripEmbeddedData(text)).toBe(text);
	});
});
