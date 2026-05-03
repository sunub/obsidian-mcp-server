import * as fs from "node:fs";
import { dirname } from "node:path";
import * as util from "node:util";
import chalk from "chalk";
import dotenv from "dotenv";

dotenv.config();

class DebugLogger {
	private logStream: fs.WriteStream | undefined;

	constructor() {
		const logFilePath = process.env["DEBUG_LOG_FILE"] || "logs/debug.log";

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
		console.error(chalk.green("[INFO]"), chalk.green(util.format(...args)));
	}

	writeInfo(...args: unknown[]): void {
		this.writeToFile("INFO", args);
	}

	writeError(...args: unknown[]): void {
		this.writeToFile("ERROR", args);
	}

	writeDebug(...args: unknown[]): void {
		this.writeToFile("DEBUG", args);
	}

	writeWarn(...args: unknown[]): void {
		this.writeToFile("WARN", args);
	}

	log(...args: unknown[]): void {
		this.writeToFile("LOG", args);
		console.error(chalk.blue("[LOG]"), chalk.gray(util.format(...args)));
	}

	warn(...args: unknown[]): void {
		this.writeToFile("WARN", args);
		console.error(chalk.yellow("[WARN]"), chalk.yellow(util.format(...args)));
	}

	error(...args: unknown[]): void {
		this.writeToFile("ERROR", args);
		console.error(chalk.red("[ERROR]"), chalk.red(util.format(...args)));
	}

	debug(...args: unknown[]): void {
		this.writeToFile("DEBUG", args);
		console.error(chalk.bgGrey("[DEBUG]"), chalk.bgGrey(util.format(...args)));
	}
}

export const debugLogger = new DebugLogger();
