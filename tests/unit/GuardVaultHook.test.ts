import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const hookPath = resolve("plugin/hooks/guard-vault.mjs");
const blockReason =
	"Vault 파일은 셸로 옮기거나 지우거나 덮어쓰지 마세요. 이동과 삭제는 tidy_plan과 plan_apply를 쓰세요. 링크가 깨지지 않게 하기 위해서입니다.";

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
		options: {
			cwd?: string;
			vaultPath?: string | null;
			home?: string;
		} = {},
	) => {
		const env: NodeJS.ProcessEnv = { ...process.env };
		if (options.home) env.HOME = options.home;
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
		expect(output).not.toBeNull();
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

	const fill = (template: string) =>
		template.replaceAll("{v}", vault).replaceAll("{o}", outside);

	test.each([
		'ls\nrm "{v}/a.md"',
		'cd "{v}"\nrm a.md',
		'rm \\\n  "{v}/a.md"',
		'echo ok & rm "{v}/a.md"',
		'rm "$VAULT_DIR_PATH/a.md"',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: 셸 변수 문법을 그대로 전달한다
		"rm ${VAULT_DIR_PATH}/a.md",
		'cd "$VAULT_DIR_PATH" && rm a.md',
		'NOTES="{v}"; rm "$NOTES/a.md"',
		'export NOTES="{v}" && rm "$NOTES/a.md"',
		'/bin/rm "{v}/a.md"',
		'sudo rm "{v}/a.md"',
		'sudo -u someone rm "{v}/a.md"',
		'env LANG=C rm "{v}/a.md"',
		'command rm "{v}/a.md"',
		'LANG=C rm "{v}/a.md"',
		'(cd "{v}" && rm a.md)',
		'{ rm "{v}/a.md"; }',
		'if true; then rm "{v}/a.md"; fi',
		'echo $(rm "{v}/a.md")',
		"find \"{v}\" -name '*.md' | xargs rm",
		'find "{v}" -print0 | xargs -0 -n 1 rm -f',
		'find "{v}" -name a.md -delete',
		'find "{v}" -name a.md -exec rm {} \\;',
		'git -C "{v}" mv a.md b.md',
		'git -C "{v}" rm a.md',
		'echo x > "{v}/a.md"',
		'echo x >> "{v}/a.md"',
		'echo x >| "{v}/a.md"',
		'ls missing 2> "{v}/error.log"',
		'ls &> "{v}/all.log"',
		'cat <<EOF > "{v}/a.md"\nbody\nEOF',
		'echo x | tee -a "{v}/a.md"',
		'cp "{o}/a.md" "{v}/a.md"',
		'cp -t "{v}" "{o}/a.md"',
		'rsync -a "{o}/" "{v}/"',
		'rsync -a --remove-source-files "{v}/" "{o}/"',
		'for f in "{v}"/*.md; do rm "$f"; done',
	])("Vault를 바꾸는 명령은 막는다: %s", (template) => {
		expectBlocked(run(fill(template)));
	});

	test.each([
		"git mv a.md b.md",
		"git rm a.md",
		"find . -delete",
		"ls | xargs rm",
		"printf x >a.md",
	])("작업 폴더가 Vault일 때 상대 경로 변경은 막는다: %s", (command) => {
		expectBlocked(run(command, { cwd: vault }));
	});

	test("물결표로 시작하는 Vault 경로도 막는다", () => {
		expectBlocked(run("rm ~/vault/a.md", { home: root }));
	});

	test.each([
		'cp "{v}/a.md" "{o}/a.md"',
		'rsync -a "{v}/" "{o}/"',
		'cat "{v}/a.md" > "{o}/copy.md"',
		'ls "{v}" 2>/dev/null',
		'ls "{v}" 2>&1',
		'grep "a > b" "{v}/a.md"',
		"echo 'rm {v}/a.md'",
		'echo done # rm "{v}/a.md"',
		"cat <<'EOF' > \"{o}/run.sh\"\nrm {v}/a.md\nEOF",
		'(cd "{v}") && rm a.md',
		'find "{v}" -name "*.md"',
		'find "{v}" -name "*.md" | xargs grep foo',
		'find "{o}" -name a.md -delete',
		"rm '$VAULT_DIR_PATH/a.md'",
	])("Vault를 바꾸지 않는 명령은 통과: %s", (template) => {
		expect(run(fill(template))).toBeNull();
	});

	test.each([
		"git status",
		"git rm --cached a.md",
		'git commit -m "rm old note"',
		"ls 2>/dev/null",
	])("작업 폴더가 Vault여도 파일을 바꾸지 않으면 통과: %s", (command) => {
		expect(run(command, { cwd: vault })).toBeNull();
	});
});
