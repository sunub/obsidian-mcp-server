import { describe, expect, test } from "vitest";
import {
	CHUNK_OVERLAP,
	CHUNK_SIZE,
	createDocumentChunker,
} from "../../src/utils/worker/chunkDocument";

const BIRTH = "2025-01-01T00:00:00.000Z";
// 테스트에서는 글자 수를 토큰 수로 본다
const charLength = (text: string) => text.length;

const longSection = (word: string) =>
	Array.from({ length: 120 }, (_, i) => `${word} 문장 ${i}.`).join(" ");

describe("createDocumentChunker", () => {
	test("임베딩 모델 기준 256/32 토큰으로 자른다", () => {
		expect(CHUNK_SIZE).toBe(256);
		expect(CHUNK_OVERLAP).toBe(32);
	});

	test("넘겨받은 길이 함수 기준으로 모든 청크가 CHUNK_SIZE 이하다", async () => {
		const chunk = createDocumentChunker(charLength);
		const records = await chunk({
			filePath: "/vault/note.md",
			fileContent: `# 제목\n\n${longSection("가")}`,
			birthTime: BIRTH,
		});

		expect(records.length).toBeGreaterThan(1);
		for (const r of records) {
			expect(charLength(r.content)).toBeLessThanOrEqual(CHUNK_SIZE);
		}
	});

	test("길이 함수가 다르면 청크 수도 달라진다", async () => {
		const input = {
			filePath: "/vault/note.md",
			fileContent: longSection("가"),
			birthTime: BIRTH,
		};
		const byChars = await createDocumentChunker(charLength)(input);
		const byWords = await createDocumentChunker(
			(text) => text.split(/\s+/).length,
		)(input);

		expect(byWords.length).toBeLessThan(byChars.length);
	});

	test("청크에 섹션 제목과 문서 목차를 문맥으로 붙인다", async () => {
		const chunk = createDocumentChunker(charLength);
		const records = await chunk({
			filePath: "/vault/note.md",
			fileContent: `# 문서\n\n## 첫 섹션\n${longSection("가")}\n\n## 둘째 섹션\n${longSection("나")}`,
			birthTime: BIRTH,
		});
		const last = records.at(-1);

		expect(last?.context).toContain("Section: 둘째 섹션");
		expect(last?.context).toContain("Outline: 문서 > 첫 섹션 > 둘째 섹션");
	});

	test("base64 data URI는 청크에 들어가지 않는다", async () => {
		const chunk = createDocumentChunker(charLength);
		const payload = "iVBORw0KGgo".repeat(500);
		const records = await chunk({
			filePath: "/vault/note.md",
			fileContent: `본문\n![](data:image/png;base64,${payload})\n끝`,
			birthTime: BIRTH,
		});

		expect(records).toHaveLength(1);
		expect(records[0]?.content).not.toContain("base64");
	});
});

// 청크가 어느 섹션에 속하는지 정하는 로직(findSectionForChunk)을 검증한다.
// 청크 본문을 본문에서 다시 검색해 위치를 추측하면, 같은 내용이 반복될 때 항상 첫 등장 위치로 매핑된다.
describe("createDocumentChunker - 섹션 매핑", () => {
	const chunkOf = (fileContent: string) =>
		createDocumentChunker(charLength)({
			filePath: "/vault/note.md",
			fileContent,
			birthTime: BIRTH,
		});

	const sectionOf = (context: string) =>
		/^Section: (.+)$/m.exec(context)?.[1] ?? null;

	// 번호 없이 반복되는 항목이라 청크 내용만으로는 어느 섹션인지 알 수 없다
	const repeated = Array.from(
		{ length: 40 },
		(_, i) => `- 체크 항목 ${i % 5} 확인`,
	).join("\n");

	test("같은 내용이 여러 섹션에 반복돼도 청크는 자기 섹션 제목을 단다", async () => {
		const records = await chunkOf(
			`## 설계\n\n${repeated}\n\n## 구현\n\n${repeated}\n\n## 회고\n\n${repeated}\n`,
		);
		const sections = records.map((r) => sectionOf(r.context));

		// 청크는 문서 순서대로 나온다. 연속된 같은 섹션을 합치면 설계 → 구현 → 회고여야 한다.
		// 현재 버그가 있으면 반복 내용이 모두 첫 섹션("설계")으로 매핑돼 [설계, 구현, 설계, 회고, 설계]처럼 나온다.
		const collapsed = sections.filter((s, i) => s !== sections[i - 1]);
		expect(collapsed).toEqual(["설계", "구현", "회고"]);
	});

	test("반복 섹션 하나가 여러 청크로 쪼개질 만큼 길다 (위 검증의 전제)", async () => {
		// 섹션이 청크 하나에 다 들어가면 매핑이 틀릴 수 없어서 위 테스트가 의미가 없다
		expect(repeated.length).toBeGreaterThan(CHUNK_SIZE * 2);
	});

	test("겹침(overlap) 때문에 앞 청크 안에서 시작하는 청크도 섹션을 찾는다", async () => {
		// 내용이 서로 달라 위치를 추측할 수 있는 문서. 다음 청크는 이전 청크 끝보다 앞에서 시작한다.
		const unique = (prefix: string) =>
			Array.from({ length: 120 }, (_, i) => `${prefix}문장${i}.`).join(" ");
		const records = await chunkOf(
			`## 가섹션\n${unique("가")}\n\n## 나섹션\n${unique("나")}`,
		);

		expect(records.length).toBeGreaterThan(4);
		for (const r of records) {
			// 제목 줄로 시작하는 청크는 건너뛰고, 본문으로 시작하는 청크만 본다
			if (r.content.startsWith("#")) continue;
			const expected = r.content.startsWith("가") ? "가섹션" : "나섹션";
			// 위치를 못 찾으면 섹션이 사라지므로(null) 여기서 걸린다
			expect(sectionOf(r.context), r.content.slice(0, 20)).toBe(expected);
		}
	});

	test("섹션 경계에 걸친 청크는 시작 위치의 섹션을 따른다", async () => {
		const unique = (prefix: string) =>
			Array.from({ length: 120 }, (_, i) => `${prefix}문장${i}.`).join(" ");
		const records = await chunkOf(
			`## 가섹션\n${unique("가")}\n\n## 나섹션\n${unique("나")}`,
		);
		// 가섹션 → 나섹션 순서가 뒤집히거나 다시 가섹션으로 돌아가면 안 된다
		const sections = records.map((r) => sectionOf(r.context));
		const collapsed = sections.filter((s, i) => s !== sections[i - 1]);

		expect(collapsed).toEqual(["가섹션", "나섹션"]);
	});

	test("첫 제목 앞의 본문에는 Section 문맥을 붙이지 않는다", async () => {
		const records = await chunkOf(`머리말입니다.\n\n## 첫 제목\n내용입니다.`);
		const first = records[0];

		expect(first?.content.startsWith("머리말")).toBe(true);
		expect(sectionOf(first?.context ?? "")).toBeNull();
	});

	test("제목이 없는 문서에는 Section 문맥이 없다", async () => {
		const records = await chunkOf(longSection("가"));

		expect(records.length).toBeGreaterThan(1);
		for (const r of records) {
			expect(sectionOf(r.context)).toBeNull();
		}
	});

	test("청크 id와 순번은 0부터 연속된다", async () => {
		const records = await chunkOf(
			`## 설계\n\n${repeated}\n\n## 구현\n\n${repeated}`,
		);

		records.forEach((r, i) => {
			expect(r.chunkIndex).toBe(i);
			expect(r.id).toBe(`/vault/note.md_chunk_${i}`);
		});
	});
});
