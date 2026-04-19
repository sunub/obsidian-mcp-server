import state from "../config.js";

export interface LLMChatResponse {
	model: string;
	created_at: string;
	choices: Array<{
		message: {
			role: string;
			content: string;
		};
		finish_reason: string;
	}>;
	done: boolean;
}

export interface LLMEmbeddingResponse {
	data: Array<{
		embedding: number[];
		index: number;
		object: string;
	}>;
	model: string;
	object: string;
	usage: {
		prompt_tokens: number;
		total_tokens: number;
	};
}

export class LLMClient {
	// 설정값을 실시간으로 가져오기 위한 Getter들
	private get apiUrl() {
		return state.llmApiUrl.replace(/\/$/, "");
	}
	private get embeddingApiUrl() {
		return state.llmEmbeddingApiUrl.replace(/\/$/, "");
	}
	private get embeddingModel() {
		return state.llmEmbeddingModel;
	}
	private get chatModel() {
		return state.llmChatModel;
	}

	/**
	 * 청크의 문맥(Context)을 생성합니다. (OpenAI Chat Completion 호환)
	 */
	async generateContext(
		documentContext: string,
		chunkContent: string,
	): Promise<string> {
		const prompt = `<document>
${documentContext}
</document>

Summarize in 1-2 sentences how this chunk fits the above document:

<chunk>
${chunkContent}
</chunk>`;

		const url = `${this.apiUrl}/v1/chat/completions`;
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: this.chatModel,
					messages: [{ role: "user", content: prompt }],
					max_tokens: 80,
					temperature: 0,
					stream: false,
				}),
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(
					`LLM API error (${response.status}) at ${url}: ${errorBody || response.statusText}`,
				);
			}

			const data = (await response.json()) as LLMChatResponse;
			return data.choices[0].message.content.trim();
		} catch (error) {
			console.error(`Error generating context from LLM at ${url}:`, error);
			return "";
		}
	}

	async generateEmbedding(text: string): Promise<number[]> {
		const url = `${this.embeddingApiUrl}/v1/embeddings`;
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: this.embeddingModel,
					input: text,
				}),
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(
					`Embedding API error (${response.status}) at ${url}: ${errorBody || response.statusText}`,
				);
			}

			const data = (await response.json()) as LLMEmbeddingResponse;
			if (!data.data || !data.data[0] || !data.data[0].embedding) {
				throw new Error(`Invalid embedding response structure from ${url}`);
			}
			return data.data[0].embedding;
		} catch (error) {
			console.error(`Error generating embedding from LLM at ${url}:`, error);
			throw error;
		}
	}
}

export const llmClient = new LLMClient();
