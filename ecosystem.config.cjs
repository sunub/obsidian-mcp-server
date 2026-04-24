module.exports = {
	apps: [
		{
			name: "llama-server-gemma4",
			script: `llama-server -hf unsloth/gemma-4-31B-it-GGUF --hf-file "gemma-4-31B-it-Q4_K_M.gguf" -c 8192 -ngl 99 --port 8080`,
			interpreter: "none",
			exec_mode: "fork",
		},
	],
};
