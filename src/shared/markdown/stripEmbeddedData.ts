// 본문에 직접 넣은 이미지 등의 base64 data URI. 검색할 의미가 없는데 청크 수와 임베딩 시간을 크게 차지한다.
const BASE64_DATA_URI = /data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g;

/** 청킹 전에 본문에서 base64 data URI를 지운다. 이미지 문법(`![alt]()`)과 대체 텍스트는 남긴다. */
export function stripEmbeddedData(text: string): string {
	return text.replace(BASE64_DATA_URI, "");
}
