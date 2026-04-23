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
	console.log(
		chalk.cyan.bold("\n🚀 Obsidian MCP Server: Local Model Setup\n"),
	);

	// 1. 사전 정보 제공 및 강조
	console.log(chalk.bgBlue.white.bold(" 🔍 설치 상세 정보 "));
	console.log(
		`${chalk.yellow("▶")} ${chalk.bold("모델 설치 경로:")} ${chalk.cyan(MODELS_DIR)}`,
	);
	console.log(
		`${chalk.yellow("▶")} ${chalk.bold("총 다운로드 용량:")} 약 ${chalk.green("300MB")}`,
	);
	console.log(
		`${chalk.yellow("▶")} ${chalk.bold("데이터 제거 방법:")} 더 이상 사용하지 않으시려면 아래 디렉토리를 완전히 삭제해 주세요:`,
	);
	console.log(`   ${chalk.gray("rm -rf " + APP_DATA_DIR)}`);

	console.log(chalk.blue.bold("\n🧠 설치될 AI 모델 및 목적:"));
	console.log(
		`  • ${chalk.bold("Xenova/bge-reranker-base")}\n    - ${chalk.white("정밀 검색 순위 재조정: 검색 결과의 정확도를 비약적으로 향상시킵니다.")}`,
	);
	console.log(
		`  • ${chalk.bold("Xenova/paraphrase-multilingual-MiniLM-L12-v2")}\n    - ${chalk.white("다국어 시맨틱 임베딩: 한국어를 포함한 다국어 문서의 의미를 깊게 파악합니다.")}`,
	);

	console.log(
		chalk.dim(
			"\n※ 모든 과정은 로컬에서 수행되며, 귀하의 문서는 외부로 전송되지 않습니다.\n",
		),
	);

	// 2. 사용자 동의 확인 (inquirer 사용)
	const answers = await inquirer.prompt([
		{
			type: "confirm",
			name: "confirmed",
			message: "위 내용을 확인하였으며, 로컬 모델 설치를 진행하시겠습니까?",
			default: true,
		},
	]);

	if (!answers.confirmed) {
		console.log(chalk.red("\n❌ 사용자가 설치를 취소했습니다. 서버가 기본 모드로 동작합니다.\n"));
		process.exit(0);
	}

	console.log(chalk.cyan("\n⏳ 설치를 시작합니다. 잠시만 기다려 주세요...\n"));

	// 3. 디렉토리 준비
	ensureAppDataDirs();

	// 4. 환경 설정: 원격 다운로드 허용 및 로컬 경로 지정
	env.allowRemoteModels = true;
	env.localModelPath = MODELS_DIR;

	const models = [
		{ name: "Xenova/bge-reranker-base", type: "text-classification" },
		{
			name: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
			type: "feature-extraction",
		},
	];

	// 5. 다운로드 진행
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
			spinner.fail(
				chalk.red(`Failed to download ${modelInfo.name}: ${error}`),
			);
		}
	}

	console.log(
		chalk.cyan.bold(
			"\n✨ 모든 설정이 완료되었습니다! 이제 고성능 하이브리드 검색을 사용할 수 있습니다.\n",
		),
	);
}

setup().catch((err) => {
	console.error(chalk.red("\n🚨 치명적인 오류가 발생했습니다:"), err);
	process.exit(1);
});
