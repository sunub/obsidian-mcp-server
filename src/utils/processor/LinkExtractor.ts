export function extractImageLinks(content: string): string[] {
	const imageLinks: string[] = [];
	const wikiLinkRegex = /!\[\[([^\]]+)\]\]/g;
	const markdownLinkRegex = /!\[.*?\]\((.*?)\)/g;

	let match: RegExpExecArray | null;
	match = wikiLinkRegex.exec(content);
	while (match !== null) {
		imageLinks.push(match[1]);
		match = wikiLinkRegex.exec(content);
	}
	match = markdownLinkRegex.exec(content);
	while (match !== null) {
		imageLinks.push(match[1]);
		match = markdownLinkRegex.exec(content);
	}
	return imageLinks;
}

export function extractDocumentLinks(content: string): string[] {
	const docLinks: string[] = [];
	const wikiLinkRegex = /(?<!!)\[\[([^\]]+)\]\]/g;

	let match: RegExpExecArray | null;
	match = wikiLinkRegex.exec(content);
	while (match !== null) {
		// 링크에서 앨리어스(|)나 앵커(#) 부분을 제거하고 순수 파일 이름만 추출합니다.
		const link = match[1].split(/\||#/)[0];
		docLinks.push(link);
		match = wikiLinkRegex.exec(content);
	}
	return docLinks;
}
