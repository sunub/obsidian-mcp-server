import {
	AutoModelForSequenceClassification,
	AutoTokenizer,
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

async function checkModelStatus(name: string, type: string): Promise<boolean> {
	try {
		// local_files_only: true 설정을 통해 로컬에 완전하게 파일이 있는지 검증
		if (type === "text-classification") {
			await AutoTokenizer.from_pretrained(name, { local_files_only: true });
			await AutoModelForSequenceClassification.from_pretrained(name, {
				local_files_only: true,
			});
		} else {
			await pipeline(type as any, name, { local_files_only: true });
		}
		return true;
	} catch (e) {
		return false;
	}
}

async function setup() {
	console.log(chalk.cyan.bold("\n🚀 Obsidian MCP Server: Local Model Setup\n"));

	// 1. 사전 환경 점검 및 상태 표시
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
	
	// 환경 설정 초기화 (로컬 경로 우선)
	env.localModelPath = MODELS_DIR;
	env.allowRemoteModels = false;

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

	// 2. 사용자 동의 확인
	const message = allReady
		? "All models are already installed and working. Would you like to re-install/verify them?"
		: "Some models are missing or incomplete. Proceed with the installation?";

	const answers = await inquirer.prompt([
		{
			type: "confirm",
			name: "confirmed",
			message: message,
			default: !allReady,
		},
	]);

	if (!answers.confirmed) {
		console.log(
			chalk.yellow(
				"\n👋 Setup skipped. The server will operate based on current model availability.\n",
			),
		);
		process.exit(0);
	}

	console.log(chalk.cyan("\n⏳ Starting installation/verification. Please wait...\n"));

	ensureAppDataDirs();

	// 다운로드를 위해 일시적으로 원격 허용
	env.allowRemoteModels = true;

	for (const modelInfo of models) {
		const spinner = ora({
			text: chalk.white(`Processing ${modelInfo.name}...`),
			color: "cyan",
		}).start();

		try {
			if (modelInfo.type === "text-classification") {
				await AutoTokenizer.from_pretrained(modelInfo.name);
				await AutoModelForSequenceClassification.from_pretrained(
					modelInfo.name,
				);
			} else {
				await pipeline(modelInfo.type as any, modelInfo.name);
			}
			spinner.succeed(chalk.green(`Successfully processed ${modelInfo.name}`));
		} catch (error) {
			spinner.fail(chalk.red(`Failed to process ${modelInfo.name}: ${error}`));
		}
	}

	// 최종 확인
	env.allowRemoteModels = false;
	const finalCheckSpinner = ora("Verifying installation...").start();
	const finalResults = await Promise.all(models.map(m => checkModelStatus(m.name, m.type)));
	
	if (finalResults.every(r => r)) {
		finalCheckSpinner.succeed(chalk.green.bold("Verification successful!"));
		console.log(
			chalk.cyan.bold(
				"\n✨ Setup complete! High-performance hybrid search is now fully enabled.\n",
			),
		);
	} else {
		finalCheckSpinner.fail(chalk.red.bold("Verification failed. Some files might be missing."));
		console.log(chalk.yellow("\nPlease check your internet connection or disk space and try again.\n"));
	}
	
	process.exit(0);
}

setup().catch((err) => {
	console.error(chalk.red("\n🚨 Fatal error during setup:"), err);
	process.exit(1);
});
