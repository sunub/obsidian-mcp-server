import * as fs from "node:fs";
import * as util from "node:util";
import { dirname } from "node:path";
import chalk from "chalk";

class DebugLogger {
	private logStream: fs.WriteStream | undefined;

	constructor() {
		const logFilePath = process.env["DEBUG_LOG_FILE"];

		if (logFilePath) {
			const logDir = dirname(logFilePath);

			if (!fs.existsSync(logDir)) {
				fs.mkdirSync(logDir, { recursive: true });
			}

			this.logStream = fs.createWriteStream(logFilePath, {
				flags: "a",
			});
		}

		this.logStream?.on("error", (err) => {
			console.error(
				chalk.red("[STREAM_ERROR]"),
				chalk.gray(util.format("Error writing to debug log stream:", err)),
			);
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

	info(...args: unknown[]): void {
		this.writeToFile("INFO", args);
		console.info(chalk.green("[INFO]"), chalk.gray(util.format(...args)));
	}

	log(...args: unknown[]): void {
		this.writeToFile("LOG", args);
		console.log(chalk.blue("[LOG]"), chalk.white(util.format(...args)));
	}

	warn(...args: unknown[]): void {
		this.writeToFile("WARN", args);
		console.warn(chalk.yellow("[WARN]"), chalk.gray(util.format(...args)));
	}

	error(...args: unknown[]): void {
		this.writeToFile("ERROR", args);
		console.error(chalk.red("[ERROR]"), chalk.gray(util.format(...args)));
	}

	debug(...args: unknown[]): void {
		this.writeToFile("DEBUG", args);
		console.debug(chalk.magenta("[DEBUG]"), chalk.gray(util.format(...args)));
	}
}

export const debugLogger = new DebugLogger();
