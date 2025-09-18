export class LinkExtractor {
  public static extractImageLinks(content: string): string[] {
    const imageLinks: string[] = [];
    const wikiLinkRegex = /!\[\[([^\]]+)\]\]/g;
    const markdownLinkRegex = /!\[.*?\]\((.*?)\)/g;

    let match;
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      imageLinks.push(match[1]);
    }
    while ((match = markdownLinkRegex.exec(content)) !== null) {
      imageLinks.push(match[1]);
    }
    return imageLinks;
  }

  public static extractDocumentLinks(content: string): string[] {
    const docLinks: string[] = [];
    const wikiLinkRegex = /(?<!\!)\[\[([^\]]+)\]\]/g;

    let match;
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      // 링크에서 앨리어스(|)나 앵커(#) 부분을 제거하고 순수 파일 이름만 추출합니다.
      const link = match[1].split(/\||#/)[0];
      docLinks.push(link);
    }
    return docLinks;
  }
}
