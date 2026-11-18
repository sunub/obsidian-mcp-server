/**
 * 청킹 기준 비교 실험용 청커 (docs/search-quality-evaluation.md 4.8).
 *
 * src/utils/worker/chunkingWorker.ts 와 같은 레코드를 만들되, 아래 세 가지를 바꿔 볼 수 있다.
 *   tokenizer: 청크 길이를 셀 토크나이저. "cl100k"(현재, GPT 계열) | "model"(임베딩 모델)
 *   size / overlap: 청크 크기와 겹침(토큰)
 *   split: "recursive"(현재, 문단→줄→공백) | "heading"(Markdown 제목으로 먼저 나눈 뒤 긴 섹션만 재귀 분할)
 *
 * 벤치마크는 RAGIndexer의 워커 풀 대신 이 함수를 같은 프로세스에서 호출한다.
 * cl100k + 500/50 + recursive 는 현재 워커와 같은 청크를 만들어야 한다(재현 확인용).
 */
import path from "node:path";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { encodingForModel } from "js-tiktoken";

export type ChunkVariant = {
	name: string;
	tokenizer: "cl100k" | "model";
	size: number;
	overlap: number;
	split: "recursive" | "heading";
};

type ChunkInput = { filePath: string; fileContent: string; birthTime: string };
type Heading = { heading: string; pos: number; depth: number };

export function parseVariant(spec: string): ChunkVariant {
	// 예: "model:256:32:heading"
	const [tokenizer, size, overlap, split] = spec.split(":");
	if (
		(tokenizer !== "cl100k" && tokenizer !== "model") ||
		(split !== "recursive" && split !== "heading")
	) {
		throw new Error(`잘못된 청커 지정: ${spec}`);
	}
	return {
		name: spec,
		tokenizer,
		size: Number(size),
		overlap: Number(overlap),
		split,
	};
}

/** 코드 블록 안의 `# 주석`은 제목으로 보지 않는다. */
function extractHeadings(body: string): Heading[] {
	const results: Heading[] = [];
	let inFence = false;
	let pos = 0;
	for (const line of body.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
		const m = !inFence && /^(#{1,3})\s+(.+)$/.exec(line);
		if (m) {
			results.push({
				heading: (m[2] as string).trim(),
				pos,
				depth: (m[1] as string).length,
			});
		}
		pos += line.length + 1;
	}
	return results;
}

/** 현재 워커와 같은 정규식(코드 블록 구분 없음). recursive 모드에서 현재 동작을 그대로 재현하기 위해 쓴다. */
function extractHeadingsLegacy(body: string): Heading[] {
	return [...body.matchAll(/^(#{1,3})\s+(.+)$/gm)].map((m) => ({
		heading: (m[2] as string).trim(),
		pos: m.index ?? 0,
		depth: (m[1] as string).length,
	}));
}

/** 현재 워커와 같은 방식: 청크 앞 60자를 본문에서 찾아 그 앞의 마지막 제목을 섹션으로 본다. */
function findSectionForChunk(
	body: string,
	chunk: string,
	headings: Heading[],
): string | null {
	if (headings.length === 0) return null;
	const pos = body.indexOf(chunk.slice(0, 60));
	if (pos === -1) return null;
	let section: string | null = null;
	for (const h of headings) {
		if (h.pos <= pos) section = h.heading;
	}
	return section;
}

export async function createVariantChunker(
	variant: ChunkVariant,
	deps: {
		parseMatter: (
			filePath: string,
			birthTime: string,
			content: string,
		) => {
			frontmatter: Record<string, unknown> & { tags?: string[] };
			content: string;
		};
		stripEmbeddedData: (text: string) => string;
		countModelTokens: (text: string) => number;
	},
) {
	let lengthFunction: (text: string) => number;
	if (variant.tokenizer === "cl100k") {
		const enc = encodingForModel("gpt-3.5-turbo");
		lengthFunction = (text) => enc.encode(text).length;
	} else {
		lengthFunction = deps.countModelTokens;
	}
	const splitter = new RecursiveCharacterTextSplitter({
		chunkSize: variant.size,
		chunkOverlap: variant.overlap,
		lengthFunction,
	});

	/** 본문을 [섹션 제목, 섹션 본문] 목록으로 나눈다. heading 모드에서만 사용. */
	function splitByHeadings(
		body: string,
		headings: Heading[],
	): { section: string | null; text: string }[] {
		const parts: { section: string | null; text: string }[] = [];
		const first = headings[0];
		if (!first) return [{ section: null, text: body }];
		if (first.pos > 0)
			parts.push({ section: null, text: body.slice(0, first.pos) });
		headings.forEach((h, i) => {
			const end = headings[i + 1]?.pos ?? body.length;
			parts.push({ section: h.heading, text: body.slice(h.pos, end) });
		});
		return parts.filter((p) => p.text.trim().length > 0);
	}

	return async function chunk(input: ChunkInput) {
		const { filePath, fileContent, birthTime } = input;
		const fileName = path.basename(filePath);
		const { frontmatter, content } = deps.parseMatter(
			filePath,
			birthTime,
			fileContent,
		);
		const body = deps.stripEmbeddedData(content);

		const headings =
			variant.split === "recursive"
				? extractHeadingsLegacy(body)
				: extractHeadings(body);
		const titleFromBody = headings.find((h) => h.depth === 1)?.heading ?? null;
		const docTitle = frontmatter.title || titleFromBody || fileName;
		const docStructure = headings
			.filter((h) => h.depth <= 2)
			.slice(0, 4)
			.map((h) => h.heading.slice(0, 25));

		const pieces: { section: string | null; text: string }[] = [];
		if (variant.split === "recursive") {
			for (const text of await splitter.splitText(body)) {
				pieces.push({
					section: findSectionForChunk(body, text, headings),
					text,
				});
			}
		} else {
			for (const part of splitByHeadings(body, headings)) {
				for (const text of await splitter.splitText(part.text)) {
					pieces.push({ section: part.section, text });
				}
			}
		}

		return pieces.map(({ section, text }, i) => {
			const context = [
				section ? `Section: ${section.slice(0, 30)}` : "",
				docStructure.length > 1
					? `Outline: ${docStructure.slice(0, 3).join(" > ")}`
					: "",
			]
				.filter(Boolean)
				.join("\n");
			return {
				id: `${filePath}_chunk_${i}`,
				filePath,
				fileName,
				chunkIndex: i,
				content: text,
				context,
				metadata: {
					title: docTitle,
					date:
						frontmatter.date instanceof Date
							? frontmatter.date.toISOString()
							: frontmatter.date || birthTime,
					tags: frontmatter.tags?.join(", ") ?? "",
					summary: frontmatter.summary || "",
					slug: frontmatter.slug || "",
					category: frontmatter.category || "any",
					completed: frontmatter.completed ?? false,
				},
			};
		});
	};
}
