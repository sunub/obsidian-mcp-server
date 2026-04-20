module.exports = {
	apps: [
		{
			name: "llama-server-gemma4",
			script: `llama-server -hf unsloth/gemma-4-31B-it-GGUF --hf-file "gemma-4-31B-it-Q4_K_M.gguf" -c 8192 -ngl 99 --port 8080`,
			interpreter: "none",
			exec_mode: "fork",
		},
		{
			name: "llama-embedding-server",
			script: `llama-server -hf nomic-ai/nomic-embed-text-v1.5-GGUF --hf-file "nomic-embed-text-v1.5.Q8_0.gguf" --embedding -ngl 99 --port 8081 -c 2048 -b 2048 -ub 2048`,
			interpreter: "none",
			exec_mode: "fork",
		},
		{
			name: "llama-reranker-server",
			script:
				"llama-server -hf gpustack/bge-reranker-v2-m3-GGUF --port 8082 -ngl 99 -c 2048 -b 2048 -ub 2048 --rerank",
			interpreter: "none",
			exec_mode: "fork",
		},
	],
};
