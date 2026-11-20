import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const hookPath = resolve("plugin/hooks/guard-vault.mjs");
const blockReason =
	"Vault 파일은 tidy_plan과 plan_apply로 옮기거나 지우세요. 링크가 깨지지 않게 하기 위해서입니다.";

describe("guard-vault Hook", () => {
	let root: string;
	let vault: string;
	let outside: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "guard-vault-"));
		vault = join(root, "vault");
		outside = join(root, "outside");
		mkdirSync(vault);
		mkdirSync(outside);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const run = (
		command: string,
		options: { cwd?: string; vaultPath?: string | null } = {},
	) => {
		const env: NodeJS.ProcessEnv = { ...process.env };
		const vaultPath =
			options.vaultPath === undefined ? vault : options.vaultPath;
		if (vaultPath === null) {
			delete env.VAULT_DIR_PATH;
		} else {
			env.VAULT_DIR_PATH = vaultPath;
		}
		const result = spawnSync("node", [hookPath], {
			input: JSON.stringify({
				hook_event_name: "PreToolUse",
				tool_name: "Bash",
				tool_input: { command },
				cwd: options.cwd ?? outside,
			}),
			env,
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		return result.stdout.trim() === "" ? null : JSON.parse(result.stdout);
	};

	const expectBlocked = (output: ReturnType<typeof run>) => {
		expect(output.hookSpecificOutput.hookEventName).toBe("PreToolUse");
		expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(output.hookSpecificOutput.permissionDecisionReason).toBe(
			blockReason,
		);
	};

	test("Vault 안 파일의 mv는 막는다", () => {
		expectBlocked(
			run(`mv "${join(vault, "a.md")}" "${join(outside, "a.md")}"`),
		);
	});

	test("cd로 Vault 안에 있을 때 상대 경로 rm은 막는다", () => {
		expectBlocked(run("rm 무제.md", { cwd: vault }));
		expectBlocked(run(`cd "${vault}" && rm 무제.md`));
	});

	test("Vault 밖 rm은 통과", () => {
		expect(run(`rm "${join(outside, "a.md")}"`)).toBeNull();
		expect(run("rm a.md", { cwd: outside })).toBeNull();
	});

	test("Vault 안 ls, cat은 통과", () => {
		expect(run(`ls "${vault}"`)).toBeNull();
		expect(run(`cat "${join(vault, "a.md")}"`)).toBeNull();
		expect(run("grep foo a.md", { cwd: vault })).toBeNull();
	});

	test("VAULT_DIR_PATH가 없으면 통과", () => {
		expect(run(`rm "${join(vault, "a.md")}"`, { vaultPath: null })).toBeNull();
		expect(run(`rm "${join(vault, "a.md")}"`, { vaultPath: "" })).toBeNull();
	});

	test("&&로 이어진 두 번째 명령도 검사한다", () => {
		expectBlocked(run(`ls && rm "${join(vault, "a.md")}"`));
	});

	test("Vault 폴더 이름만 접두사로 공유하는 형제 폴더는 통과", () => {
		expect(run(`rm "${vault}-backup/a.md"`)).toBeNull();
	});
});
