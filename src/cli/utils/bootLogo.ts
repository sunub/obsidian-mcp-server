import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { theme } from "@cli/theme/semantic-colors.js";
import chalk from "chalk";
import pkg from "../../../package.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.resolve(
	__dirname,
	"../../../assets/llama-cli-logo-v2.png",
);

const KITTY_CHUNK_SIZE = 4096;
const BOOT_IMAGE_COLUMNS = 15;
const BOOT_IMAGE_ROWS = 9;

function supportsKittyBootLogo(env: NodeJS.ProcessEnv): boolean {
	return Boolean(
		env["TERM_PROGRAM"] === "ghostty" ||
			env["TERM_PROGRAM"] === "Ghostty" ||
			env["TERM_PROGRAM"] === "WezTerm" ||
			env["TERM_PROGRAM"] === "kitty" ||
			env["KONSOLE_VERSION"] ||
			env["TERM"]?.includes("kitty"),
	);
}

function chunkBase64Payload(
	data: string,
	chunkSize = KITTY_CHUNK_SIZE,
): string[] {
	const chunks: string[] = [];

	for (let offset = 0; offset < data.length; offset += chunkSize) {
		chunks.push(data.slice(offset, offset + chunkSize));
	}

	return chunks;
}

export async function renderBootLogo(
	stdout: NodeJS.WriteStream,
): Promise<void> {
	const writeTextFallback = (): void => {
		stdout.write(
			chalk.hex(theme.text.accent).bold("LLaMA CLI ") +
				chalk.hex(theme.text.primary)(`v${pkg.version}`) +
				"\n",
		);
		stdout.write(
			"A command-line interface for LLaMA-based local LLM servers, providing seamless integration and management of your local LLM resources.\n\n",
		);
	};

	if (!supportsKittyBootLogo(process.env)) {
		writeTextFallback();
		return;
	}

	try {
		const logoPng = await fs.readFile(logoPath);
		const base64Payload = logoPng.toString("base64");
		const chunks = chunkBase64Payload(base64Payload);
		const leftPadding = Math.max(
			0,
			Math.floor(((stdout.columns ?? 80) - BOOT_IMAGE_COLUMNS) / 2),
		);
		const padding = " ".repeat(leftPadding);

		stdout.write(padding);

		chunks.forEach((chunk, index) => {
			const isFirst = index === 0;
			const isLast = index === chunks.length - 1;
			const metadata = isFirst
				? `a=T,f=100,c=${BOOT_IMAGE_COLUMNS},r=${BOOT_IMAGE_ROWS},q=2,m=${
						isLast ? 0 : 1
					};`
				: `m=${isLast ? 0 : 1},q=2;`;

			stdout.write(`\x1b_G${metadata}${chunk}\x1b\\`);
		});

		stdout.write("\r");
		stdout.write(
			padding +
				chalk.hex(theme.text.accent).bold("LLaMA CLI ") +
				chalk.hex(theme.text.primary)(`v${pkg.version}`) +
				"\n",
		);
		stdout.write(
			"A command-line interface for llama.cpp based local LLM servers, providing seamless integration and management of your local LLM resources.\n\n",
		);
	} catch {
		writeTextFallback();
	}
}

export const __bootLogoTestUtils = {
	supportsKittyBootLogo,
	chunkBase64Payload,
};
