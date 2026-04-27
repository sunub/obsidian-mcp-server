import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import dotenv from "dotenv";
import state from "@/config.js";
import { llmClient } from "@/utils/LLMClient.js";

dotenv.config();

const log = (...args: unknown[]) => console.log(...args);

async function runTestSearch() {
	try {
		// 1. 실제 Obsidian Vault 내의 Vector DB 경로 설정
		if (!state.vaultPath) {
			throw new Error("VAULT_DIR_PATH is not set.");
		}
		const dbPath = path.join(state.vaultPath, ".obsidian", "vector_cache");
		log(`\n📂 연결된 금고: ${state.vaultPath}`);
		log(`🗄️ DB 경로: ${dbPath}`);

		const db = await lancedb.connect(dbPath);
		const tableNames = await db.tableNames();

		if (!tableNames.includes("obsidian_chunks")) {
			log(
				"❌ 'obsidian_chunks' 테이블을 찾을 수 없습니다. 인덱싱이 먼저 필요합니다.",
			);
			return;
		}

		// 2. 실제 서버가 사용하는 테이블 열기
		const table = await db.openTable("obsidian_chunks");
		const queryText = "LCP";

		log(`🌐 임베딩 서버: ${state.llmEmbeddingApiUrl}`);
		log(`🔍 Searching for: "${queryText}" in actual Obsidian index...`);

		// 3. LLMClient를 사용하여 임베딩 생성 (접두사 및 정규화 자동 처리)
		const queryVector = await llmClient.generateEmbedding(
			`search_query: ${queryText}`,
		);

		// 4. LanceDB 벡터 검색 수행
		const searchResults = await table
			.vectorSearch(queryVector)
			.limit(5)
			.toArray();

		// 5. 결과 출력
		if (searchResults.length === 0) {
			log("No relevant documents found.");
		} else {
			log(`\n✅ Found ${searchResults.length} results:`);
			searchResults.forEach((res, i) => {
				log(`\n[Result ${i + 1}] Distance: ${res._distance.toFixed(4)}`);
				log(`FileName: ${res.fileName}`);
				log(`Path: ${res.filePath}`);
				log(
					`Content Sample: ${res.content.substring(0, 200).replace(/\n/g, " ")}...`,
				);
				if (res.metadata) {
					log(`Metadata Title: ${res.metadata.title}`);
				}
				log("--------------------------------------------------");
			});
		}
	} catch (error) {
		console.error("❌ 테스트 검색 중 오류 발생:", error);
	}
}

runTestSearch();
