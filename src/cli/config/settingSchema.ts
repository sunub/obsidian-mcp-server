export type SettingsType =
	| "boolean"
	| "string"
	| "number"
	| "array"
	| "object"
	| "enum";

export type SettingsValue =
	| boolean
	| string
	| number
	| string[]
	| object
	| undefined;

export enum MergeStrategy {
	SHALLOW_MERGE = "shallow_merge",
	CONCAT = "concat",
	UNION = "union",
	REPLACE = "replace",
}

export interface SettingEnumOption {
	value: string;
	label: string;
}

export interface SettingCollectionDefinition {
	type: SettingsType;
	description?: string;
	ref?: string;
}

export interface SettingDefinition {
	type: SettingsType;
	label: string;
	category: string;
	requiresRestart: boolean;
	default: SettingsValue;
	description?: string;
	parentKey?: string;
	childKey?: string;
	key?: string;
	properties?: SettingsSchema;
	showInDialog?: boolean;
	ignoreInDocs?: boolean;
	mergeStrategy?: MergeStrategy;
	/** Enum type options  */
	options?: readonly SettingEnumOption[];
	/**
	 * For collection types (e.g. arrays), describes the shape of each item.
	 */
	items?: SettingCollectionDefinition;
	/**
	 * For map-like objects without explicit `properties`, describes the shape of the values.
	 */
	additionalProperties?: SettingCollectionDefinition;
	/**
	 * Optional unit to display after the value (e.g. '%').
	 */
	unit?: string;
	/**
	 * Optional reference identifier for generators that emit a `$ref`.
	 */
	ref?: string;
}

export interface SettingsSchema {
	[key: string]: SettingDefinition;
}

export const SETTINGS_SCHEMA = {
	// 1. Obsidian Vault 설정 (핵심)
	obsidian: {
		type: "object",
		label: "Obsidian Vault",
		category: "Obsidian",
		requiresRestart: true,
		default: {},
		description: "Obsidian Vault 연동 및 데이터 관리 설정",
		showInDialog: true,
		properties: {
			vaultPath: {
				type: "string",
				label: "Vault 절대 경로",
				category: "Obsidian",
				requiresRestart: true,
				default: "",
				description: "Obsidian Vault 디렉토리의 절대 경로 (VAULT_DIR_PATH)",
				showInDialog: true,
			},
			loggingLevel: {
				type: "enum",
				label: "로그 레벨",
				category: "Obsidian",
				requiresRestart: false,
				default: "info",
				description: "서버 로그 기록 상세 수준",
				showInDialog: true,
				options: [
					{ value: "debug", label: "Debug" },
					{ value: "info", label: "Info" },
					{ value: "warn", label: "Warn" },
					{ value: "error", label: "Error" },
				],
			},
			metricsLogPath: {
				type: "string",
				label: "메트릭 로그 경로",
				category: "Obsidian",
				requiresRestart: false,
				default: "",
				description:
					"토큰 사용량 등 메트릭을 기록할 JSONL 파일 경로 (VAULT_METRICS_LOG_PATH)",
				showInDialog: true,
			},
		},
	},

	// 2. LLM & RAG 설정 (GEMINI.md 기준 필수)
	llm: {
		type: "object",
		label: "LLM (Local RAG)",
		category: "RAG",
		requiresRestart: true,
		default: {},
		description: "로컬 AI 모델 연동 및 임베딩 설정",
		showInDialog: true,
		properties: {
			apiUrl: {
				type: "string",
				label: "Chat API URL",
				category: "RAG",
				requiresRestart: true,
				default: "http://127.0.0.1:8080",
				description: "로컬 LLM 채팅 서버 주소 (LLM_API_URL)",
				showInDialog: true,
			},
			chatModel: {
				type: "string",
				label: "채팅 모델",
				category: "RAG",
				requiresRestart: true,
				default: "llama3",
				description: "답변 생성에 사용할 모델명 (LLM_CHAT_MODEL)",
				showInDialog: true,
			},
		},
	},

	// 3. 일반 설정
	general: {
		type: "object",
		label: "일반 설정",
		category: "General",
		requiresRestart: false,
		default: {},
		description: "일반적인 애플리케이션 설정",
		showInDialog: true,
		properties: {
			defaultApprovalMode: {
				type: "enum",
				label: "도구 승인 모드",
				category: "General",
				requiresRestart: false,
				default: "default",
				description: "도구 실행 시 승인 절차를 제어합니다.",
				showInDialog: true,
				options: [
					{ value: "default", label: "승인 필요" },
					{ value: "auto_edit", label: "자동 수정 허용" },
				],
			},
		},
	},
} as const satisfies SettingsSchema;
