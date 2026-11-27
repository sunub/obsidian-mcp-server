import path from "node:path";
import { changesVault } from "./vault-rules.mjs";

const BLOCK_REASON =
	"Vault 파일은 셸로 옮기거나 지우거나 덮어쓰지 마세요. 이동과 삭제는 tidy_plan과 plan_apply를 쓰세요. 링크가 깨지지 않게 하기 위해서입니다.";

const readStdin = async () => {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
};

const main = async () => {
	const vaultRoot = process.env.VAULT_DIR_PATH;
	if (!vaultRoot) return;

	const input = JSON.parse(await readStdin());
	const command = input.tool_input?.command;
	if (typeof command !== "string") return;

	const cwd = input.cwd ?? process.cwd();
	const blocked = changesVault(command, {
		cwd,
		vaultRoot: path.resolve(vaultRoot),
		env: { ...process.env, PWD: cwd },
	});
	if (!blocked) return;

	process.stdout.write(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: BLOCK_REASON,
			},
		}),
	);
};

await main();
