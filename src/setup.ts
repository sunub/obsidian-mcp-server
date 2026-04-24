import { fileURLToPath } from "node:url";
import { env, type PipelineType, pipeline } from "@huggingface/transformers";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import {
	APP_DATA_DIR,
	ensureAppDataDirs,
	MODELS_DIR,
} from "./utils/constants.js";

env.localModelPath = MODELS_DIR;
env.cacheDir = MODELS_DIR;
env.allowRemoteModels = false;

async function checkModelStatus(name: string, type: string): Promise<boolean> {
	try {
		await pipeline(type as PipelineType, name, {
			local_files_only: true,
		});
		return true;
	} catch (_e) {
		return false;
	}
}

export async function setup(options = { force: false }) {
	console.log(chalk.cyan.bold("\n🚀 Obsidian MCP Server: Local Model Setup\n"));

	ensureAppDataDirs();

	const models = [
		{
			name: "Xenova/bge-reranker-base",
			type: "text-classification",
			label: "BGE Reranker (Base)",
			desc: "Improves search relevance by re-ordering results.",
		},
		{
			name: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
			type: "feature-extraction",
			label: "Multilingual MiniLM",
			desc: "Provides deep understanding of multilingual documents.",
		},
	];

	console.log(chalk.blue.bold("🔍 Current Model Status:"));

	const statusList = [];
	for (const m of models) {
		const spinner = ora(`Checking ${m.label}...`).start();
		const isReady = await checkModelStatus(m.name, m.type);
		if (isReady) {
			spinner.succeed(`${chalk.bold(m.label)}: ${chalk.green("Ready")}`);
		} else {
			spinner.warn(
				`${chalk.bold(m.label)}: ${chalk.yellow("Not Found or Incomplete")}`,
			);
		}
		statusList.push({ ...m, isReady });
	}

	const allReady = statusList.every((s) => s.isReady);
	if (!options.force && allReady) {
		return true;
	}

	console.log(chalk.blue.bold("\n📦 Installation Details:"));
	console.log(
		`${chalk.yellow("▶")} ${chalk.bold("Model Path:")} ${chalk.cyan(MODELS_DIR)}`,
	);
	console.log(
		`${chalk.yellow("▶")} ${chalk.bold("Download Size:")} Approx. ${chalk.green("300MB")}`,
	);
	console.log(
		`${chalk.yellow("▶")} ${chalk.bold("Uninstallation:")} ${chalk.white(`rm -rf ${APP_DATA_DIR}`)}`,
	);

	console.log(
		chalk.dim(
			"\n※ All processing happens locally. Your documents are never sent to external servers.\n",
		),
	);

	const answers = await inquirer.prompt([
		{
			type: "confirm",
			name: "confirmed",
			message: allReady
				? "All models are already installed. Re-verify them?"
				: "Proceed with the installation?",
			default: !allReady,
		},
	]);

	if (!answers.confirmed) {
		console.log(chalk.yellow("\n👋 Setup skipped.\n"));
		process.exit(0);
	}

	console.log(
		chalk.cyan("\n⏳ Starting processing. This may take a few minutes...\n"),
	);

	env.allowRemoteModels = true;

	for (const modelInfo of models) {
		const spinner = ora({
			text: chalk.white(`Processing ${modelInfo.name}...`),
			color: "cyan",
		}).start();

		try {
			await pipeline(modelInfo.type as PipelineType, modelInfo.name);
			spinner.succeed(chalk.green(`Successfully processed ${modelInfo.name}`));
		} catch (error) {
			spinner.fail(
				chalk.red(
					`Failed to process ${modelInfo.name}: ${error instanceof Error ? error.message : error}`,
				),
			);
		}
	}

	env.allowRemoteModels = false;
	const finalCheckSpinner = ora("Verifying installation...").start();
	const finalResults = await Promise.all(
		models.map((m) => checkModelStatus(m.name, m.type)),
	);

	if (finalResults.every((r) => r)) {
		finalCheckSpinner.succeed(chalk.green.bold("Verification successful!"));
		console.log(
			chalk.cyan.bold(
				"\n✨ Setup complete! High-performance hybrid search is enabled.\n",
			),
		);
	} else {
		finalCheckSpinner.fail(chalk.red.bold("Verification failed."));
		console.log(chalk.yellow("\nPlease check your internet and try again.\n"));
	}

	return finalResults.every((r) => r);
}

const isMain =
	process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
console.log(isMain, import.meta.url);

if (isMain || process.argv[1]?.endsWith("setup.js")) {
	setup({ force: true })
		.catch((error) => {
			console.error(chalk.red("\n🚨 Fatal error during setup:"), error);
			process.exit(1);
		})
		.then(() => process.exit(0));
}
