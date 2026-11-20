import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, test } from "vitest";
import {
	buildLinkGraph,
	readJournal,
	scanVault,
	topFolderOf,
	type VaultSnapshot,
} from "../../src/shared/vault-ops/index.js";
import { cleanupFixtures, copyFixture } from "../helpers/fixture.js";

const SERVER_ENTRY = path.join(process.cwd(), "build", "index.js");

type ToolText = {
	content: { type: string; text: string }[];
	isError?: boolean;
};

let client: Client | null = null;
let fakeHome: string | null = null;

afterEach(async () => {
	await client?.close();
	client = null;
	if (fakeHome) await fs.rm(fakeHome, { recursive: true, force: true });
	fakeHome = null;
	await cleanupFixtures();
});

async function startServer(vaultRoot: string): Promise<{ stderr: string[] }> {
	fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "vault-tidy-home-"));
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [SERVER_ENTRY],
		env: {
			PATH: process.env["PATH"] ?? "",
			HOME: fakeHome,
			VAULT_DIR_PATH: vaultRoot,
		},
		stderr: "pipe",
	});
	const stderr: string[] = [];
	transport.stderr?.on("data", (chunk: Buffer) => {
		stderr.push(...chunk.toString("utf-8").split("\n"));
	});
	client = new Client({ name: "vault-tidy-e2e", version: "0.0.0" });
	await client.connect(transport);
	return { stderr };
}

async function callJson<T>(
	name: string,
	args: Record<string, unknown>,
): Promise<T> {
	if (!client) throw new Error("server not started");
	const result = (await client.callTool({ name, arguments: args })) as ToolText;
	const text = result.content[0]?.text ?? "";
	if (result.isError) throw new Error(`${name} failed: ${text}`);
	return JSON.parse(text) as T;
}

function hashMap(snapshot: VaultSnapshot): Record<string, string> {
	return Object.fromEntries(snapshot.files.map((f) => [f.path, f.hash]));
}

async function brokenTargets(root: string): Promise<string[]> {
	const snapshot = await scanVault(root);
	const graph = await buildLinkGraph(snapshot, (p) =>
		fs.readFile(path.join(root, p), "utf-8"),
	);
	return graph.refs
		.filter((ref) => ref.resolved === null)
		.map((ref) => ref.target);
}

type Preview = {
	planId: string;
	bulk: { id: string }[];
	per_item: { id: string }[];
	needsTitle: { path: string }[];
};

type ApplyResult = { runId: string; applied: string[]; rejected: unknown[] };
type UndoResult = { conflicts: unknown[] };

describe("Vault 정리 종단 테스트", () => {
	test("정리 → 깨진 링크 없음 → 되돌리기 → 원상복구", async () => {
		const root = await copyFixture();
		const before = await scanVault(root);
		const { stderr } = await startServer(root);

		const preview = await callJson<Preview>("tidy_plan", {});
		const approvedOpIds = [...preview.bulk, ...preview.per_item].map(
			(op) => op.id,
		);
		const renames = preview.needsTitle.map((entry) => ({
			path: entry.path,
			title: "CORS 정리",
		}));
		expect(approvedOpIds.length).toBeGreaterThan(0);
		expect(renames).toHaveLength(1);

		const applied = await callJson<ApplyResult>("plan_apply", {
			planId: preview.planId,
			approvedOpIds,
			renames,
		});
		expect(applied.rejected).toEqual([]);
		expect(applied.applied).toHaveLength(approvedOpIds.length + renames.length);

		expect(await brokenTargets(root)).toEqual(["없는노트"]);

		const journal = await readJournal(root, applied.runId);
		expect(journal).not.toBeNull();
		const moves = (journal?.entries ?? []).flatMap((entry) =>
			entry.kind === "move" ? [entry] : [],
		);
		for (const move of moves.filter((m) => m.from.endsWith(".md"))) {
			if (topFolderOf(move.from) !== null) {
				expect(topFolderOf(move.to)).toBe(topFolderOf(move.from));
			}
		}

		const after = await scanVault(root);
		const beforePaths = new Set(before.files.map((f) => f.path));
		const moveTargets = new Set(moves.map((m) => m.to));
		const newPaths = after.files
			.map((f) => f.path)
			.filter((p) => !beforePaths.has(p));
		expect(newPaths.filter((p) => !moveTargets.has(p))).toEqual([]);
		const hiddenEntries = (await fs.readdir(root)).filter((name) =>
			name.startsWith("."),
		);
		const allowedHidden = [".obsidian", ".trash", ".vault-tidy", ".gitkeep"];
		expect(
			hiddenEntries.filter((name) => !allowedHidden.includes(name)),
		).toEqual([]);

		const undone = await callJson<UndoResult>("plan_undo", {
			runId: applied.runId,
		});
		expect(undone.conflicts).toEqual([]);

		const restored = await scanVault(root);
		expect(hashMap(restored)).toEqual(hashMap(before));
		expect(restored.emptyFolders).toEqual(before.emptyFolders);

		expect(stderr.filter((line) => /error/i.test(line))).toEqual([]);
	}, 60000);
});
