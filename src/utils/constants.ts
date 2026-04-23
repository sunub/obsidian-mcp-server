import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";

/**
 * 전역 앱 데이터 저장 경로 (사용자 홈 디렉토리 하위)
 * 예: /Users/username/.obsidian-mcp-server
 */
export const APP_DATA_DIR = join(homedir(), ".obsidian-mcp-server");

/**
 * 로컬 모델 저장 경로
 */
export const MODELS_DIR = join(APP_DATA_DIR, "models");

/**
 * 필요한 디렉토리들이 존재하지 않으면 생성합니다.
 */
export function ensureAppDataDirs() {
	if (!existsSync(APP_DATA_DIR)) {
		mkdirSync(APP_DATA_DIR, { recursive: true });
	}
	if (!existsSync(MODELS_DIR)) {
		mkdirSync(MODELS_DIR, { recursive: true });
	}
}
