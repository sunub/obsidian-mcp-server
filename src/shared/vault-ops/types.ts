export type FileKind = "note" | "attachment" | "other";

export type VaultFile = {
	path: string;
	kind: FileKind;
	size: number;
	hash: string;
	mtimeMs: number;
};

export type VaultSnapshot = {
	root: string;
	files: VaultFile[];
	folders: string[];
	emptyFolders: string[];
};

export type LinkForm = "wiki" | "embed" | "markdown" | "markdown-embed";

export type ParsedLink = {
	from: string;
	raw: string;
	start: number;
	end: number;
	target: string;
	form: LinkForm;
	suffix: string;
};

export type LinkRef = ParsedLink & {
	resolved: string | null;
	ambiguous: boolean;
};

export interface LinkGraph {
	readonly refs: readonly LinkRef[];
	inbound(path: string): LinkRef[];
	outbound(path: string): LinkRef[];
}

export type RiskTier = "bulk" | "per_item" | "report";
export type ActionTier = Exclude<RiskTier, "report">;

export type MoveOp = {
	id: string;
	type: "move";
	from: string;
	to: string;
	tier: ActionTier;
	reason: string;
};

export type TrashOp = {
	id: string;
	type: "trash";
	path: string;
	redirectTo: string | null;
	tier: ActionTier;
	reason: string;
};

export type RemoveEmptyFolderOp = {
	id: string;
	type: "removeEmptyFolder";
	path: string;
	tier: ActionTier;
	reason: string;
};

export type ReportOp = {
	id: string;
	type: "report";
	paths: string[];
	tier: "report";
	reason: string;
};

export type PlanOp = MoveOp | TrashOp | RemoveEmptyFolderOp | ReportOp;

export type NeedsTitle = { path: string; preview: string };
export type TitleRename = { path: string; title: string };

export type ChangePlan = {
	planId: string;
	createdAt: string;
	source: string;
	scope: string | null;
	ops: PlanOp[];
	needsTitle: NeedsTitle[];
	fileHashes: Record<string, string>;
};

export type TidyOptions = {
	attachmentsFolderName: string;
	scope: string | null;
};

export const DEFAULT_TIDY_OPTIONS: TidyOptions = {
	attachmentsFolderName: "attachments",
	scope: null,
};

export type PlannerContext = {
	snapshot: VaultSnapshot;
	graph: LinkGraph;
	options: TidyOptions;
	readNote: (path: string) => Promise<string>;
};

export type PlannerOutput = { ops: PlanOp[]; needsTitle: NeedsTitle[] };
export type Planner = (ctx: PlannerContext) => Promise<PlannerOutput>;

export type ApplyRequest = {
	planId: string;
	approvedOpIds: string[];
	renames: TitleRename[];
};

export type ApplyResult = {
	runId: string;
	applied: string[];
	rejected: { opId: string; reason: string }[];
	rewrittenLinks: number;
	removedFolders: string[];
};

export type UndoResult = {
	runId: string;
	restored: number;
	conflicts: { path: string; reason: string }[];
};

export type JournalEntry =
	| { kind: "createFolder"; path: string }
	| { kind: "move"; from: string; to: string; hash: string }
	| { kind: "trash"; from: string; to: string; hash: string }
	| { kind: "rewrite"; path: string; before: string; afterHash: string }
	| { kind: "removeFolder"; path: string };

export type RunJournal = {
	runId: string;
	planId: string;
	createdAt: string;
	undoneAt: string | null;
	entries: JournalEntry[];
};

export type VaultToolDeps = { vaultRoot: () => string };

export const VAULT_TIDY_DIR = ".vault-tidy";
export const TRASH_DIR = ".trash";
export const EXCLUDED_DIRS: readonly string[] = [
	".obsidian",
	".trash",
	".vault-tidy",
	".git",
];
export const NOTE_EXTENSIONS: readonly string[] = [".md"];
export const ATTACHMENT_EXTENSIONS: readonly string[] = [
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".avif",
	".svg",
	".bmp",
	".pdf",
	".mp3",
	".mp4",
	".mov",
	".webm",
	".wav",
];
