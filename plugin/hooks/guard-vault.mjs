import path from "node:path";

const MUTATING_COMMANDS = new Set([
	"mv",
	"rm",
	"cp",
	"rsync",
	"unlink",
	"rmdir",
	"trash",
]);

const BLOCK_REASON =
	"Vault 파일은 tidy_plan과 plan_apply로 옮기거나 지우세요. 링크가 깨지지 않게 하기 위해서입니다.";

const normalizeForCompare = (value) => value.normalize("NFC").toLowerCase();

const isInside = (target, vaultRoot) => {
	const relative = path.relative(
		normalizeForCompare(vaultRoot),
		normalizeForCompare(target),
	);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
};

const splitSegments = (command) => command.split(/&&|\|\||;|\|/);

const tokenize = (segment) => {
	const tokens = [];
	const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
	for (const match of segment.matchAll(pattern)) {
		tokens.push(match[1] ?? match[2] ?? match[3]);
	}
	return tokens;
};

const touchesVault = (command, initialCwd, vaultRoot) => {
	let cwd = initialCwd;
	for (const segment of splitSegments(command)) {
		const [name, ...args] = tokenize(segment);
		if (name === "cd" && args.length > 0) {
			cwd = path.resolve(cwd, args[0]);
			continue;
		}
		if (!MUTATING_COMMANDS.has(name)) continue;
		const operands = args.filter((arg) => !arg.startsWith("-"));
		if (operands.some((arg) => isInside(path.resolve(cwd, arg), vaultRoot))) {
			return true;
		}
	}
	return false;
};

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
	if (!touchesVault(command, cwd, path.resolve(vaultRoot))) return;

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
