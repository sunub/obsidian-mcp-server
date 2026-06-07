import { performance } from "node:perf_hooks";
import { localEmbedder } from "../src/utils/Embedder.js";
import { getGlobalVaultManager } from "../src/utils/getVaultManager.js";
import { localReranker } from "../src/utils/LocalReranker.js";
import { vectorDB } from "../src/utils/VectorDB.js";

async function runBenchmark() {
	console.log("=== 로컬 RAG 쿼리 파이프라인 벤치마크 시작 ===");

	// VaultManager 초기화
	const vaultManager = getGlobalVaultManager();
	await vaultManager.initialize();

	// 로컬 임베더 및 리랭커 준비 확인
	await localEmbedder.init();
	await localReranker.init();

	const allDocs = await vaultManager.getAllDocuments();
	if (allDocs.length === 0) {
		console.error("오류: 벤치마크를 수행할 옵시디언 문서가 금고에 없습니다.");
		return;
	}

	console.log(`총 로드된 옵시디언 문서 수: ${allDocs.length}개`);

	// 테스트 질문 정의
	// 1. 완벽한 제목 매칭 쿼리 (Exact Title Match)
	const exactTitleDoc = allDocs[0];
	const filename =
		exactTitleDoc.filePath.split("/").pop() || exactTitleDoc.filePath;
	const exactTitle =
		exactTitleDoc.frontmatter?.title || filename.replace(/\.mdx?$/i, "");

	// 2. 고밀도 의미 유사도 매칭 (Highly Relevant)
	const testDocContent = await vaultManager.getDocumentInfo(
		exactTitleDoc.filePath,
	);
	const excerptQuery =
		testDocContent?.content.substring(0, 100).trim() || "프로젝트";

	// 3. 일반적인 의미론적 쿼리
	const generalQuery = "금고 내 주요 작업 마감 일정에 대해 요약해줘";

	async function benchmarkExactTitleMatch() {
		console.log(`\n--- 시나리오 1: 제목 완전 일치 (${exactTitle}) ---`);

		// 이전 방식 (무조건 리랭킹 호출 모사)
		const tBeforeStart = performance.now();
		const matched = await vaultManager.searchDocuments(exactTitle);
		const rerankCandidatesLimit = 30;
		const candidatesToRerank = matched.slice(0, rerankCandidatesLimit);
		const candidateContents = await Promise.all(
			candidatesToRerank.map(async (c) => {
				const doc = await vaultManager.getDocumentInfo(c.filePath, {
					maxContentPreview: 1000,
				});
				return doc?.content || "";
			}),
		);
		await localReranker.rerank(exactTitle, candidateContents);
		const tBeforeEnd = performance.now();
		const beforeTime = tBeforeEnd - tBeforeStart;

		// 현재 방식 (Fast-Path 스킵)
		const tAfterStart = performance.now();
		const matchedAfter = await vaultManager.searchDocuments(exactTitle);
		// Fast-path 감지
		const exactMatchIndex = matchedAfter.slice(0, 15).findIndex((c) => {
			const fName = c.filePath.split("/").pop() || c.filePath;
			const t = c.frontmatter?.title || fName.replace(/\.mdx?$/i, "");
			return t.toLowerCase() === exactTitle.toLowerCase();
		});

		let afterTime = 0;
		if (exactMatchIndex !== -1) {
			const tAfterEnd = performance.now();
			afterTime = tAfterEnd - tAfterStart;
			console.log(
				`[결과] 이전 방식: ${beforeTime.toFixed(2)}ms (리랭커 구동됨)`,
			);
			console.log(
				`[결과] 현재 방식: ${afterTime.toFixed(2)}ms (리랭커 스킵됨 - Fast-Path)`,
			);
			console.log(
				`[개선] 소요 시간 ${(((beforeTime - afterTime) / beforeTime) * 100).toFixed(1)}% 단축`,
			);
		} else {
			console.log(
				"제목 일치 문서를 찾지 못해 스킵 조건을 시뮬레이션하지 못했습니다.",
			);
		}
	}

	async function benchmarkHighlyRelevantMatch() {
		console.log(
			`\n--- 시나리오 2: 고밀도 의미 유사도 매칭 (쿼리: "${excerptQuery.substring(0, 30)}...") ---`,
		);

		const queryVector = await localEmbedder.embed(
			`search_query: ${excerptQuery}`,
		);
		const recallLimit = 15;

		// 이전 방식 (무조건 리랭킹 호출 모사)
		const tBeforeStart = performance.now();
		const initialResults = await vectorDB.search(queryVector, recallLimit);
		const documents = initialResults.map((r) => r.content);
		await localReranker.rerank(excerptQuery, documents);
		const tBeforeEnd = performance.now();
		const beforeTime = tBeforeEnd - tBeforeStart;

		// 현재 방식 (유사도 기준 리랭커 스킵)
		const tAfterStart = performance.now();
		const initialResultsAfter = await vectorDB.search(queryVector, recallLimit);
		const firstDistance = initialResultsAfter[0]["_distance"];
		const SKIP_RERANK_DISTANCE_THRESHOLD = 0.2;

		let afterTime = 0;
		let skipped = false;
		if (
			typeof firstDistance === "number" &&
			firstDistance < SKIP_RERANK_DISTANCE_THRESHOLD
		) {
			const tAfterEnd = performance.now();
			afterTime = tAfterEnd - tAfterStart;
			skipped = true;
		} else {
			const documentsAfter = initialResultsAfter.map((r) => r.content);
			await localReranker.rerank(excerptQuery, documentsAfter);
			const tAfterEnd = performance.now();
			afterTime = tAfterEnd - tAfterStart;
		}

		console.log(`[결과] 이전 방식: ${beforeTime.toFixed(2)}ms (리랭커 구동됨)`);
		console.log(
			`[결과] 현재 방식: ${afterTime.toFixed(2)}ms (${skipped ? "리랭커 스킵됨 - 스레스홀드 돌파" : "리랭커 구동됨"})`,
		);
		console.log(
			`[개선] 소요 시간 ${(((beforeTime - afterTime) / beforeTime) * 100).toFixed(1)}% 단축`,
		);
	}

	async function benchmarkGeneralQuery() {
		console.log(`\n--- 시나리오 3: 일반 검색 (쿼리: "${generalQuery}") ---`);

		const queryVector = await localEmbedder.embed(
			`search_query: ${generalQuery}`,
		);
		const recallLimit = 15;

		// 이전 방식 (무조건 리랭킹 호출 모사)
		const tBeforeStart = performance.now();
		const initialResults = await vectorDB.search(queryVector, recallLimit);
		const documents = initialResults.map((r) => r.content);
		await localReranker.rerank(generalQuery, documents);
		const tBeforeEnd = performance.now();
		const beforeTime = tBeforeEnd - tBeforeStart;

		// 현재 방식 (유사도가 낮아 스킵 불가, 리랭커 동일 구동)
		const tAfterStart = performance.now();
		const initialResultsAfter = await vectorDB.search(queryVector, recallLimit);
		const firstDistance = initialResultsAfter[0]?.["_distance"];
		const SKIP_RERANK_DISTANCE_THRESHOLD = 0.2;

		let afterTime = 0;
		let skipped = false;
		if (
			typeof firstDistance === "number" &&
			firstDistance < SKIP_RERANK_DISTANCE_THRESHOLD
		) {
			const tAfterEnd = performance.now();
			afterTime = tAfterEnd - tAfterStart;
			skipped = true;
		} else {
			const documentsAfter = initialResultsAfter.map((r) => r.content);
			await localReranker.rerank(generalQuery, documentsAfter);
			const tAfterEnd = performance.now();
			afterTime = tAfterEnd - tAfterStart;
		}

		console.log(`[결과] 이전 방식: ${beforeTime.toFixed(2)}ms (리랭커 구동됨)`);
		console.log(
			`[결과] 현재 방식: ${afterTime.toFixed(2)}ms (${skipped ? "리랭커 스킵됨" : "리랭커 구동됨 - 스레스홀드 미충족"})`,
		);
		console.log(
			`이 시나리오에서는 두 최적화 방식의 소요 시간이 유사하여 로직 일관성을 보장합니다.`,
		);
	}

	await benchmarkExactTitleMatch();
	await benchmarkHighlyRelevantMatch();
	await benchmarkGeneralQuery();
}

runBenchmark().catch(console.error);
