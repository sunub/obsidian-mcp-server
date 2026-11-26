# RAG 실습 코드

RAG 학습 코스(`rag-study-guide.html`)의 브라우저 실습은 모두 이 파일들의 코드로 실행됩니다. 의존성은 없고 Node.js 18 이상만 있으면 됩니다.

```bash
node --test lab.test.mjs
```

| 파일 | 내용 | 코스 모듈 |
|---|---|---|
| `tokenize.mjs` | 본문 토큰화, 질의 토큰의 세 가지 형태(원형, 앞뒤 문장부호 제거, 중간 조각) | 토큰화와 역색인 |
| `bm25.mjs` | tf와 문서 길이를 저장하는 역색인, BM25, 이 프로젝트 방식(IDF 가중 불리언 + 최소 일치) | BM25 |
| `rrf.mjs` | Reciprocal Rank Fusion(가중치 지원), min-max 점수 합산 | 하이브리드와 RRF |
| `chunker.mjs` | 고정 크기, 재귀 분할(LangChain `RecursiveCharacterTextSplitter`와 같은 결과), 제목 기준, 섹션 문맥 | 청킹 |
| `metrics.mjs` | Recall@k, Hit@1, MRR, nDCG, 짝지은 부트스트랩, 시드 난수 | 평가 |
| `ivf.mjs` | k-means, 정확 검색, IVF 검색(nprobes) | ANN 인덱스 |
| `lab.test.mjs` | 개념마다 하나씩, 테스트 15개 | |

## REPL에서 써 보기

```bash
node
```

```js
const { buildIndex, bm25Search, projectSearch } = await import("./bm25.mjs");
const idx = buildIndex([
  { id: "a", text: "LanceDB 색인을 다시 만든다. LanceDB는 IVF-PQ를 쓴다." },
  { id: "b", text: "청킹 크기를 256 토큰으로 줄였다." },
]);
bm25Search(idx, "lancedb", { k1: 1.2, b: 0.75 });
projectSearch(idx, "LanceDB,");
```

## 과제

과제마다 `lab.test.mjs`에 테스트를 먼저 쓰고 통과하게 고칩니다.

1. **BM25 필드 가중치.** `buildIndex`가 `{ id, title, text }`를 받아 제목 토큰을 2배로 세게 한다.
2. **한국어 조사 떼기.** 조사 목록을 떼는 함수를 색인과 질의 양쪽에 적용한다. "검색"이 "검색을"을 찾는지, "고양이"가 "고양"이 되는 오분리가 생기는지 확인한다.
3. **가중 RRF.** `rrf(lists, 60, [1, 0.5])`처럼 가중치를 바꿔 결과를 표로 비교한다.
4. **청크 통계.** 내 노트 파일로 `recursiveChunks`를 크기 100/200/400으로 돌려 청크 수, 평균 길이, 50자 미만 청크 수를 출력하고 `headingChunks`와 비교한다.
5. **작은 평가 루프.** 노트 8개, 질의 5개(정답 지정)로 `bm25Search`와 `projectSearch`의 MRR을 구하고 `pairedBootstrap`으로 구간을 낸다. 질의는 결과를 보기 전에 쓴다.
6. **nprobes 곡선.** 시드 3개로 `buildIvf`를 만들고 nprobes 1~8의 평균 Recall@10과 `scanned`를 표로 출력한다.
7. **설계.** 저장소의 `src/shared/indexing/Indexer.ts`를 진짜 BM25로 바꾸는 설계를 쓴다(역색인에 tf와 문서 길이, 증분 업데이트 시 평균 길이 갱신, 필드 처리, 비교할 평가).

과제 5의 시작 코드:

```js
import { buildIndex, bm25Search, projectSearch } from "./bm25.mjs";
import { mean, pairedBootstrap, reciprocalRank } from "./metrics.mjs";

const docs = [/* { id, text } 8개 */];
const queries = [/* { q: "질의", relevant: ["정답 id"] } 5개 */];
const idx = buildIndex(docs);
const rr = (search) => queries.map(({ q, relevant }) => reciprocalRank(search(idx, q).map((r) => r.id), new Set(relevant)));
const a = rr(projectSearch);
const b = rr(bm25Search);
console.log({ project: mean(a), bm25: mean(b), ...pairedBootstrap(a, b) });
```
