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
} from "../utils/constants.js";

async function setup() {
	console.log(chalk.cyan.bold("\n🚀 Obsidian MCP Server: Local Model Setup\n"));

	// 1. Provide preliminary information and highlights (English)
	console.log(chalk.bgBlue.white.bold(" 🔍 Installation Details "));
	console.log(
		`${chalk.yellow("▶")} ${chalk.bold("Model Path:")} ${chalk.cyan(MODELS_DIR)}`,
	);
	console.log(
		`${chalk.yellow("▶")} ${chalk.bold("Download Size:")} Approx. ${chalk.green("300MB")}`,
	);
	console.log(
		`${chalk.yellow("▶")} ${chalk.bold("Uninstallation:")} To remove these models, simply delete the following directory:`,
	);
	console.log(`   ${chalk.gray("rm -rf " + APP_DATA_DIR)}`);

	console.log(chalk.blue.bold("\n🧠 AI Models & Purpose:"));
	console.log(
		`  • ${chalk.bold("Xenova/bge-reranker-base")}\n    - ${chalk.white("Precise Reranking: Significantly improves search relevance by re-ordering results.")}`,
	);
	console.log(
		`  • ${chalk.bold("Xenova/paraphrase-multilingual-MiniLM-L12-v2")}\n    - ${chalk.white("Multilingual Semantic Embedding: Provides deep understanding of multilingual documents, including Korean.")}`,
	);

	console.log(
		chalk.dim(
			"\n※ All processing happens locally. Your documents are never sent to external servers.\n",
		),
	);

	// 2. User Consent (inquirer)
	const answers = await inquirer.prompt([
		{
			type: "confirm",
			name: "confirmed",
			message: "I have reviewed the details. Proceed with the installation?",
			default: true,
		},
	]);

	if (!answers.confirmed) {
		console.log(
			chalk.red(
				"\n❌ Installation cancelled by user. The server will operate in basic mode.\n",
			),
		);
		process.exit(0);
	}

	console.log(chalk.cyan("\n⏳ Starting installation. Please wait...\n"));

	// 3. Prepare directories
	ensureAppDataDirs();

	// 4. Config: Allow remote download and set local path
	env.allowRemoteModels = true;
	env.localModelPath = MODELS_DIR;

	const models = [
		{ name: "Xenova/bge-reranker-base", type: "text-classification" },
		{
			name: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
			type: "feature-extraction",
		},
	];

	// 5. Progress downloads
	for (const modelInfo of models) {
		const spinner = ora({
			text: chalk.white(`Downloading ${modelInfo.name}...`),
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
			spinner.succeed(chalk.green(`Successfully downloaded ${modelInfo.name}`));
		} catch (error) {
			spinner.fail(chalk.red(`Failed to download ${modelInfo.name}: ${error}`));
		}
	}

	console.log(
		chalk.cyan.bold(
			"\n✨ Setup complete! High-performance hybrid search is now enabled.\n",
		),
	);
}

setup().catch((err) => {
	console.error(chalk.red("\n🚨 Fatal error during setup:"), err);
	process.exit(1);
});
