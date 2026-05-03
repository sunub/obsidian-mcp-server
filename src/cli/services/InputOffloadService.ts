import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { debugLogger } from "../../shared/index.js";
import { APP_DATA_DIR } from "../../utils/constants.js";

const OFFLOAD_THRESHOLD = 2000;
const SUMMARY_LENGTH = 250;
const TEMP_DIR = join(APP_DATA_DIR, "temp");

export interface OffloadedFile {
	placeholder: string;
	filePath: string;
	historyId: number;
}

// 모듈 스코프 변수로 상태 관리
let offloadedFiles: OffloadedFile[] = [];

function ensureTempDir() {
	if (!existsSync(TEMP_DIR)) {
		mkdirSync(TEMP_DIR, { recursive: true });
	}
}

async function processPastedContent(
	text: string,
	pastedContent: Record<string, string>,
	historyId: number,
): Promise<string> {
	ensureTempDir();
	let finalPrompt = text;

	for (const [placeholder, content] of Object.entries(pastedContent)) {
		if (!finalPrompt.includes(placeholder)) continue;

		if (content.length > OFFLOAD_THRESHOLD) {
			const safePlaceholder = placeholder.replace(/[^a-zA-Z0-9]/g, "_");
			const fileName = `paste_${safePlaceholder}_${Date.now()}.md`;
			const filePath = join(TEMP_DIR, fileName);

			try {
				writeFileSync(filePath, content, "utf-8");
				offloadedFiles.push({ placeholder, filePath, historyId });

				const previewStart = content
					.substring(0, SUMMARY_LENGTH)
					.replace(/\n/g, " ");
				const previewEnd = content
					.substring(content.length - SUMMARY_LENGTH)
					.replace(/\n/g, " ");

				const maskInstruction = `
<user_input_masked>
[System: 대량의 데이터가 입력되어 보안 및 성능을 위해 임시 파일로 오프로딩되었습니다.]

파일 경로: ${filePath}
내용 요약(처음): "${previewStart}..."
내용 요약(끝): "...${previewEnd}"

※ 분석이 필요하면 로컬 읽기 도구를 사용하거나 사용자에게 특정 부분의 재전송을 요청하세요.
</user_input_masked>`;

				finalPrompt = finalPrompt.replace(placeholder, maskInstruction);
				debugLogger.info(
					`[OffloadService] Offloaded ${placeholder} to ${filePath}`,
				);
			} catch (error) {
				debugLogger.error(
					`[OffloadService] Failed to offload ${placeholder}:`,
					error,
				);
				finalPrompt = finalPrompt.replace(placeholder, content);
			}
		} else {
			finalPrompt = finalPrompt.replace(placeholder, content);
		}
	}
	return finalPrompt;
}

function cleanupForHistory(historyIds: number[]) {
	const remainingFiles: OffloadedFile[] = [];

	for (const file of offloadedFiles) {
		if (historyIds.includes(file.historyId)) {
			try {
				if (existsSync(file.filePath)) {
					unlinkSync(file.filePath);
					debugLogger.debug(
						`[OffloadService] Cleaned up offloaded file: ${file.filePath}`,
					);
				}
			} catch (error) {
				debugLogger.warn(
					`[OffloadService] Failed to cleanup ${file.filePath}:`,
					error,
				);
			}
		} else {
			remainingFiles.push(file);
		}
	}

	offloadedFiles = remainingFiles;
}

function cleanupAll() {
	const allIds = offloadedFiles.map((f) => f.historyId);
	cleanupForHistory(allIds);
}

function isOffloaded(placeholder: string, historyId: number): boolean {
	return offloadedFiles.some(
		(f) => f.placeholder === placeholder && f.historyId === historyId,
	);
}

function getOffloadedPath(
	placeholder: string,
	historyId: number,
): string | null {
	const file = offloadedFiles.find(
		(f) => f.placeholder === placeholder && f.historyId === historyId,
	);
	return file ? file.filePath : null;
}

function prune(activeHistoryIds: number[]) {
	const idsToCleanup = offloadedFiles
		.map((f) => f.historyId)
		.filter((fid) => !activeHistoryIds.includes(fid));

	if (idsToCleanup.length > 0) {
		cleanupForHistory(idsToCleanup);
	}
}

export const InputOffloadService = {
	processPastedContent,
	cleanupForHistory,
	cleanupAll,
	isOffloaded,
	getOffloadedPath,
	prune,
};
