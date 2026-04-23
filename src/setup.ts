import {
	env,
	pipeline,
} from "@huggingface/transformers";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import {
	APP_DATA_DIR,
	MODELS_DIR,
	ensureAppDataDirs,
} from "./utils/constants.js";

// Global configuration for transformers.js
env.localModelPath = MODELS_DIR;
env.cacheDir = MODELS_DIR;
env.allowRemoteModels = false;

async function checkModelStatus(name: string, type: string): Promise<boolean> {
	try {
		// local_files_only: true 설정을 통해 로컬에 완전하게 파일이 있는지 검증
		await pipeline(type as any, name, { 
			local_files_only: true,
		});
		return true;
	} catch (e) {
		return false;
	}
}

async function setup() {
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
			spinner.warn(`${chalk.bold(m.label)}: ${chalk.yellow("Not Found or Incomplete")}`);
		}
		statusList.push({ ...m, isReady });
	}

	const allReady = statusList.every((s) => s.isReady);

	console.log(chalk.blue.bold("\n📦 Installation Details:"));
	console.log(`${chalk.yellow("▶")} ${chalk.bold("Model Path:")} ${chalk.cyan(MODELS_DIR)}`);
	console.log(`${chalk.yellow("▶")} ${chalk.bold("Download Size:")} Approx. ${chalk.green("300MB")}`);
	console.log(`${chalk.yellow("▶")} ${chalk.bold("Uninstallation:")} ${chalk.white(`rm -rf ${APP_DATA_DIR}`)}`);

	console.log(
		chalk.dim("\n※ All processing happens locally. Your documents are never sent to external servers.\n"),
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

	console.log(chalk.cyan("\n⏳ Starting processing. This may take a few minutes...\n"));

	// 다운로드를 위해 일시적으로 원격 허용
	env.allowRemoteModels = true;

	for (const modelInfo of models) {
		const spinner = ora({
			text: chalk.white(`Processing ${modelInfo.name}...`),
			color: "cyan",
		}).start();

		try {
			// pipeline을 사용하면 tokenizer와 model을 한 번에 올바르게 처리합니다.
			await pipeline(modelInfo.type as any, modelInfo.name);
			spinner.succeed(chalk.green(`Successfully processed ${modelInfo.name}`));
		} catch (error) {
			spinner.fail(chalk.red(`Failed to process ${modelInfo.name}: ${error instanceof Error ? error.message : error}`));
		}
	}

	// 최종 확인
	env.allowRemoteModels = false;
	const finalCheckSpinner = ora("Verifying installation...").start();
	const finalResults = await Promise.all(models.map(m => checkModelStatus(m.name, m.type)));
	
	if (finalResults.every(r => r)) {
		finalCheckSpinner.succeed(chalk.green.bold("Verification successful!"));
		console.log(chalk.cyan.bold("\n✨ Setup complete! High-performance hybrid search is enabled.\n"));
	} else {
		finalCheckSpinner.fail(chalk.red.bold("Verification failed."));
		console.log(chalk.yellow("\nPlease check your internet and try again.\n"));
	}
	
	process.exit(0);
}

setup().catch((err) => {
	console.error(chalk.red("\n🚨 Fatal error during setup:"), err);
	process.exit(1);
});
