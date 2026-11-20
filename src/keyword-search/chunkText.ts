const MAX_CHUNK_CHARS = 500;
const EMBEDDED_DATA_URI =
	/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;

function splitLongText(text: string): string[] {
	const pieces: string[] = [];
	let rest = text;
	while (rest.length > MAX_CHUNK_CHARS) {
		const window = rest.slice(0, MAX_CHUNK_CHARS);
		const lastBreak = Math.max(
			window.lastIndexOf(" "),
			window.lastIndexOf("\n"),
		);
		const cut = lastBreak > MAX_CHUNK_CHARS / 2 ? lastBreak : MAX_CHUNK_CHARS;
		pieces.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest.length > 0) pieces.push(rest);
	return pieces;
}

export function splitIntoChunks(body: string): string[] {
	const paragraphs = body
		.replace(EMBEDDED_DATA_URI, "")
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph.length > 0)
		.flatMap((paragraph) =>
			paragraph.length > MAX_CHUNK_CHARS
				? splitLongText(paragraph)
				: [paragraph],
		);

	const chunks: string[] = [];
	let current = "";
	for (const paragraph of paragraphs) {
		const joined = current ? `${current}\n\n${paragraph}` : paragraph;
		if (joined.length <= MAX_CHUNK_CHARS) {
			current = joined;
			continue;
		}
		chunks.push(current);
		current = paragraph;
	}
	if (current) chunks.push(current);
	return chunks;
}
