import path from "node:path";
import { lex } from "./shell-lex.mjs";

const REMOVERS = new Set(["mv", "rm", "unlink", "rmdir", "trash"]);
const COPIERS = new Set(["cp", "rsync"]);
const LEADING_KEYWORDS = new Set([
	"!",
	"{",
	"}",
	"if",
	"then",
	"elif",
	"else",
	"while",
	"until",
	"do",
]);
const WRAPPER_OPTIONS_WITH_VALUE = new Map([
	["sudo", new Set(["-u", "-g", "-h", "-p", "-C", "-r", "-t", "-U"])],
	["doas", new Set(["-u", "-C"])],
	["env", new Set(["-u", "-C", "-S"])],
	["xargs", new Set(["-I", "-n", "-P", "-L", "-s", "-E", "-d", "-a"])],
	["nice", new Set(["-n"])],
	["command", new Set()],
	["builtin", new Set()],
	["exec", new Set(["-a"])],
	["nohup", new Set()],
	["time", new Set()],
]);
const REDIRECTS_TO_FILE = new Set([">", ">>", ">|", "&>", "&>>", ">&", "<>"]);
const REDIRECTS = new Set([
	...REDIRECTS_TO_FILE,
	"<",
	"<<",
	"<<-",
	"<<<",
	"<&",
]);
const ASSIGNMENT = /^([A-Za-z_]\w*)=(.*)$/s;

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

const expand = (word, variables) =>
	word.parts
		.map((part) =>
			part.type === "variable"
				? (variables.get(part.name) ?? part.raw)
				: part.value,
		)
		.join("");

const operandsOf = (args) => args.filter((arg) => !arg.startsWith("-"));

const assignAll = (words, variables) => {
	for (const word of words) {
		const match = ASSIGNMENT.exec(word);
		if (match) variables.set(match[1], match[2]);
	}
};

const unwrap = (words) => {
	let rest = words;
	let viaXargs = false;
	while (rest.length > 0) {
		const name = path.basename(rest[0]);
		if (LEADING_KEYWORDS.has(rest[0]) || ASSIGNMENT.test(rest[0])) {
			rest = rest.slice(1);
			continue;
		}
		const optionsWithValue = WRAPPER_OPTIONS_WITH_VALUE.get(name);
		if (!optionsWithValue) break;
		viaXargs ||= name === "xargs";
		let next = 1;
		while (next < rest.length && rest[next].startsWith("-")) {
			next += optionsWithValue.has(rest[next]) ? 2 : 1;
		}
		rest = rest.slice(next);
	}
	return { name: path.basename(rest[0] ?? ""), args: rest.slice(1), viaXargs };
};

const copyChangesVault = (name, args, insideVault) => {
	const targetOption = args.findIndex(
		(arg) => arg === "-t" || arg === "--target-directory",
	);
	const inlineTarget = args
		.find((arg) => arg.startsWith("--target-directory="))
		?.slice("--target-directory=".length);
	const destination =
		inlineTarget ??
		(name === "cp" && targetOption !== -1
			? args[targetOption + 1]
			: operandsOf(args).at(-1));
	if (destination !== undefined && insideVault(destination)) return true;
	return (
		args.includes("--remove-source-files") && operandsOf(args).some(insideVault)
	);
};

const findChangesVault = (args, insideVault) => {
	const expressionStart = args.findIndex(
		(arg) => /^[-(!]/.test(arg) && !/^-[HLP]$/.test(arg),
	);
	const roots = operandsOf(
		expressionStart === -1 ? args : args.slice(0, expressionStart),
	);
	const removes = args.some(
		(arg, index) =>
			arg === "-delete" ||
			(/^-(?:exec|execdir|ok|okdir)$/.test(arg) &&
				REMOVERS.has(path.basename(args[index + 1] ?? ""))),
	);
	return removes && (roots.length > 0 ? roots : ["."]).some(insideVault);
};

const gitChangesVault = (args, cwd, vaultRoot) => {
	let directory = cwd;
	let index = 0;
	while (index < args.length && args[index].startsWith("-")) {
		if (args[index] === "-C") {
			directory = path.resolve(directory, args[index + 1] ?? ".");
			index += 2;
		} else {
			index += args[index] === "-c" ? 2 : 1;
		}
	}
	const [subcommand, ...rest] = args.slice(index);
	if (subcommand !== "mv" && subcommand !== "rm") return false;
	if (rest.includes("--cached")) return false;
	return operandsOf(rest).some((arg) =>
		isInside(path.resolve(directory, arg), vaultRoot),
	);
};

export const changesVault = (command, { cwd, vaultRoot, env }) => {
	const shell = {
		cwd,
		variables: new Map(
			Object.entries(env).filter(([, value]) => value !== undefined),
		),
	};
	const directoryStack = [];
	let pipelineReadsVault = false;

	const insideVault = (target) =>
		isInside(path.resolve(shell.cwd, target), vaultRoot);

	const runSimpleCommand = (words, redirectTargets) => {
		if (redirectTargets.some(insideVault)) return true;

		if (words.every((word) => ASSIGNMENT.test(word))) {
			assignAll(words, shell.variables);
			return false;
		}

		if (words[0] === "for" && words[2] === "in") {
			const items = words.slice(3);
			shell.variables.set(words[1], items.find(insideVault) ?? items[0] ?? "");
			return false;
		}

		const { name, args, viaXargs } = unwrap(words);
		const operands = operandsOf(args);
		const readsVault = insideVault(".") || operands.some(insideVault);
		const fedFromVault = viaXargs && pipelineReadsVault;
		pipelineReadsVault ||= readsVault;

		if (name === "export") assignAll(args, shell.variables);
		if (name === "cd") {
			const destination = operands[0] ?? shell.variables.get("HOME") ?? ".";
			shell.cwd = path.resolve(shell.cwd, destination);
			return false;
		}
		if (REMOVERS.has(name)) return fedFromVault || operands.some(insideVault);
		if (COPIERS.has(name)) return copyChangesVault(name, args, insideVault);
		if (name === "tee") return operands.some(insideVault);
		if (name === "find") return findChangesVault(args, insideVault);
		if (name === "git") return gitChangesVault(args, shell.cwd, vaultRoot);
		return false;
	};

	let words = [];
	let redirectTargets = [];
	let redirect = null;

	const endCommand = () => {
		const changed =
			(words.length > 0 || redirectTargets.length > 0) &&
			runSimpleCommand(words, redirectTargets);
		words = [];
		redirectTargets = [];
		redirect = null;
		return changed;
	};

	for (const token of lex(command)) {
		if (token.type === "word") {
			const value = expand(token, shell.variables);
			if (redirect === null) {
				words.push(value);
				continue;
			}
			const duplicatesDescriptor =
				redirect === ">&" && /^(?:\d+|-)$/.test(value);
			if (REDIRECTS_TO_FILE.has(redirect) && !duplicatesDescriptor) {
				redirectTargets.push(value);
			}
			redirect = null;
			continue;
		}
		if (REDIRECTS.has(token.value)) {
			redirect = token.value;
			continue;
		}
		if (endCommand()) return true;
		if (token.value === "(") directoryStack.push(shell.cwd);
		if (token.value === ")") shell.cwd = directoryStack.pop() ?? shell.cwd;
		if (token.value !== "|" && token.value !== "|&") pipelineReadsVault = false;
	}
	return endCommand();
};
