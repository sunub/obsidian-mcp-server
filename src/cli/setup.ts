import {
	AutoModelForSequenceClassification,
	AutoTokenizer,
	env,
	pipeline,
} from "@huggingface/transformers";
import { join } from "node:path";
import ora from "ora";

async function setup() {
	console.log("🚀 Starting Obsidian MCP Server Local Model Setup...");

	// 1. 환경 설정: 원격 다운로드 허용 및 로컬 경로 지정
	env.allowRemoteModels = true;
	const modelPath = join(process.cwd(), "models");
	env.localModelPath = modelPath;

	const models = [
		{ name: "Xenova/bge-reranker-base", type: "text-classification" },
		{
			name: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
			type: "feature-extraction",
		},
	];

	for (const modelInfo of models) {
		const spinner = ora(`Downloading ${modelInfo.name}...`).start();
		try {
			if (modelInfo.type === "text-classification") {
				await AutoTokenizer.from_pretrained(modelInfo.name);
				await AutoModelForSequenceClassification.from_pretrained(
					modelInfo.name,
				);
			} else {
				await pipeline(modelInfo.type as any, modelInfo.name);
			}
			spinner.succeed(`Successfully downloaded ${modelInfo.name}`);
		} catch (error) {
			spinner.fail(`Failed to download ${modelInfo.name}: ${error}`);
		}
	}

	console.log("\n✅ Setup complete! Local models are now available in ./models");
	console.log(
		"You can now run the MCP server with high-performance local Reranking and Embedding.",
	);
}

setup().catch((err) => {
	console.error("Fatal error during setup:", err);
	process.exit(1);
});
