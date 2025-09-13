import matter from 'gray-matter';
import { Transform, TransformCallback } from 'stream';
import { FrontMatterSchema, type MatterTransformData } from './types.js';

export class MatterTransform extends Transform {
  private chunks: Buffer[] = [];
  private totalLength = 0;
  private frontmatterProcessed = false;
  private headerEnd = -1;

  constructor() {
    super({
      objectMode: true,
      readableObjectMode: true,
      writableObjectMode: true,
    });
  }

  _transform(chunk: Buffer, _: BufferEncoding, callback: TransformCallback): void {
    this.chunks.push(chunk);
    this.totalLength += chunk.length;

    if (!this.frontmatterProcessed) {
      const currentBuffer = Buffer.concat(this.chunks);
      const text = currentBuffer.toString('utf-8');

      let headerEnd = text.indexOf('\n---\n');
      if (headerEnd === -1) {
        headerEnd = text.indexOf('\n---\r\n');
      }

      if (headerEnd > 0) {
        try {
          const frontmatterEndIndex = headerEnd + (text.includes('\n---\r\n') ? 6 : 5);
          const frontmatterSection = text.substring(0, frontmatterEndIndex);

          const parsed = matter(frontmatterSection);
          const contentText = text.substring(frontmatterEndIndex);
          const frontmatter = FrontMatterSchema.parse(parsed.data);

          const transformData: MatterTransformData = {
            content: contentText, // ✅ 수정: 실제 파일 내용을 할당
            frontmatter,
            contentLength: contentText.length,
            hasContent: contentText.length > 0,
          };

          this.push(transformData);
          this.frontmatterProcessed = true;
          this._clearBuffers();
        } catch (error) {
          // console.warn('Frontmatter 파싱 실패:', error);
        }
      }
    }

    callback();
  }

  _flush(callback: TransformCallback): void {
    if (!this.frontmatterProcessed && this.chunks.length > 0) {
      try {
        const fullBuffer = Buffer.concat(this.chunks);
        const text = fullBuffer.toString('utf8');
        const parsed = matter(text);
        const frontmatter = FrontMatterSchema.parse(parsed.data);

        const flushData: MatterTransformData = {
          content: parsed.content,
          frontmatter,
          contentLength: parsed.content.length,
          hasContent: parsed.content.length > 0,
        };

        this.push(flushData);
      } catch {
        const fullBuffer = Buffer.concat(this.chunks);
        const text = fullBuffer.toString('utf8');

        const errorData: MatterTransformData = {
          content: text,
          frontmatter: {
            title: 'Untitled',
            date: new Date().toISOString(),
            tags: [],
            summary: '',
            slug: '',
            category: 'algorithm',
            completed: false,
          },
          contentLength: text.length,
          hasContent: text.length > 0,
        };

        this.push(errorData);
      }
    }

    this._clearBuffers();
    callback();
  }

  private _clearBuffers() {
    this.chunks = [];
    this.totalLength = 0;
    this.frontmatterProcessed = false;
    this.headerEnd = -1;
  }
}
