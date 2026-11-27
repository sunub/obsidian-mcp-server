import fs from "node:fs/promises";
import { Semaphore } from "@shared/async/semaphore.js";
import { DirectoryWalker } from "@shared/indexing/DirectoryWalker.js";
import { ragIndexer } from "@shared/indexing/RAGIndexer.js";
import { vectorDB } from "@shared/indexing/VectorDB.js";
import { localEmbedder } from "@shared/local-ai/Embedder.js";
import { localModelManager } from "@shared/local-ai/LocalModelManager.js";
import { SEARCH_SETUP_COMMAND } from "@shared/searchStatus.js";
import chalk from "chalk";
import state, { setLocalLLMEnvSetting } from "./config.js";

export type ReindexOptions = {
	vaultPath: string;
	force?: boolean;
};

export type ReindexResult = {
	success: boolean;
	mode: "force" | "migrated" | "incremental";
	totalFiles: number;
	indexedFiles: number;
	reason?: string;
};

async function findStaleMarkdownFiles(vaultPath: string): Promise<{
	totalFiles: number;
	staleFiles: string[];
}> {
	const walker = new DirectoryWalker([".md", ".mdx"]);
	const files = await walker.walk(vaultPath, new Semaphore(10));
	const staleFiles: string[] = [];

	for (const filePath of files) {
		const storedMtime = await vectorDB.getFileMtime(filePath);
		if (!storedMtime) {
			staleFiles.push(filePath);
			continue;
		}
		const fileStat = await fs.stat(filePath);
		const storedTime = new Date(storedMtime).getTime();
		if (Math.abs(storedTime - fileStat.mtimeMs) > 1000) {
			staleFiles.push(filePath);
		}
	}

	return { totalFiles: files.length, staleFiles };
}

export async function reindex(options: ReindexOptions): Promise<ReindexResult> {
	const force = options.force ?? false;
	state.vaultPath = options.vaultPath;
	setLocalLLMEnvSetting();

	const embedderReady = await localEmbedder.checkModelPresence();
	if (!embedderReady) {
		console.error(
			chalk.yellow(
				`로컬 임베딩 모델이 설치되어 있지 않습니다. 먼저 '${SEARCH_SETUP_COMMAND}'를 실행하세요.`,
			),
		);
		return {
			success: false,
			mode: force ? "force" : "incremental",
			totalFiles: 0,
			indexedFiles: 0,
			reason: "models_missing",
		};
	}

	try {
		return await localModelManager.holdModels(async () => {
			if (force) {
				console.error(
					chalk.cyan(
						`전체 벡터 인덱스를 초기화하고 재색인합니다: ${options.vaultPath}`,
					),
				);
				await vectorDB.resetIndex();
				const indexedFiles = await ragIndexer.indexAll(options.vaultPath);
				await vectorDB.createVectorIndex();
				console.error(
					chalk.green(`완료: ${indexedFiles}개 문서를 강제 재색인했습니다.`),
				);
				return {
					success: true,
					mode: "force",
					totalFiles: indexedFiles,
					indexedFiles,
				};
			}

			const migrated = await vectorDB.checkAndMigrateIfNeeded();
			if (migrated) {
				console.error(
					chalk.cyan(
						`인덱스 스키마가 갱신되어 전체 재색인을 실행합니다: ${options.vaultPath}`,
					),
				);
				const indexedFiles = await ragIndexer.indexAll(options.vaultPath);
				await vectorDB.createVectorIndex();
				console.error(
					chalk.green(`완료: ${indexedFiles}개 문서를 재색인했습니다.`),
				);
				return {
					success: true,
					mode: "migrated",
					totalFiles: indexedFiles,
					indexedFiles,
				};
			}

			const { totalFiles, staleFiles } = await findStaleMarkdownFiles(
				options.vaultPath,
			);
			if (staleFiles.length === 0) {
				console.error(
					chalk.green(
						`이미 최신 상태입니다 (${totalFiles}개 문서). 전체 재구축이 필요하면 --force 옵션을 사용하세요.`,
					),
				);
				return {
					success: true,
					mode: "incremental",
					totalFiles,
					indexedFiles: 0,
				};
			}

			console.error(
				chalk.cyan(
					`변경되거나 누락된 ${staleFiles.length}/${totalFiles}개 문서를 색인합니다...`,
				),
			);
			const indexedFiles = await ragIndexer.indexFiles(staleFiles);
			await vectorDB.createVectorIndex();
			console.error(
				chalk.green(`완료: ${indexedFiles}개 문서를 색인했습니다.`),
			);
			return {
				success: true,
				mode: "incremental",
				totalFiles,
				indexedFiles,
			};
		});
	} finally {
		await ragIndexer.shutdown();
	}
}
