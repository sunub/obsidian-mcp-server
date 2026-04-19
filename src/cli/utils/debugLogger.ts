import * as fs from "node:fs";
import * as util from "node:util";
import { dirname } from "node:path";

class DebugLogger {
	private logStream: fs.WriteStream | undefined;

	constructor() {
		const logFilePath = process.env.DEBUG_LOG_FILE;

		if (logFilePath) {
			// 1. 파일이 위치할 디렉토리 경로 추출
			const logDir = dirname(logFilePath);

			// 2. 해당 디렉토리가 존재하는지 확인하고, 없다면 생성
			// recursive: true 옵션을 주면 상위 폴더가 없어도 한 번에 생성해 줍니다.
			if (!fs.existsSync(logDir)) {
				fs.mkdirSync(logDir, { recursive: true });
			}

			// 3. 디렉토리가 확보된 상태에서 WriteStream 생성
			this.logStream = fs.createWriteStream(logFilePath, {
				flags: "a",
			});
		}

		this.logStream?.on("error", (err) => {
			console.error("Error writing to debug log stream:", err);
		});
	}

	private writeToFile(level: string, args: unknown[]) {
		if (this.logStream) {
			const message = util.format(...args);
			const timestamp = new Date().toISOString();
			const logEntry = `[${timestamp}] [${level}] ${message}\n`;
			this.logStream.write(logEntry);
		}
	}

	log(...args: unknown[]): void {
		this.writeToFile("LOG", args);
		console.log(...args);
	}

	warn(...args: unknown[]): void {
		this.writeToFile("WARN", args);
		console.warn(...args);
	}

	error(...args: unknown[]): void {
		this.writeToFile("ERROR", args);
		console.error(...args);
	}

	debug(...args: unknown[]): void {
		this.writeToFile("DEBUG", args);
		console.debug(...args);
	}
}

export const debugLogger = new DebugLogger();
