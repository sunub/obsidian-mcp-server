const OPERATORS = [
	"&>>",
	"<<<",
	"<<-",
	"&&",
	"||",
	";;",
	"|&",
	"&>",
	">>",
	">|",
	">&",
	"<<",
	"<&",
	"<>",
	";",
	"|",
	"&",
	"(",
	")",
	"`",
	">",
	"<",
];

const HEREDOC_OPERATORS = new Set(["<<", "<<-"]);
const VARIABLE = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/;
const ESCAPABLE_IN_DOUBLE_QUOTES = new Set(['"', "\\", "$", "`"]);

const literal = (value) => ({ type: "literal", value });

export const lex = (source) => {
	const tokens = [];
	const pendingHeredocs = [];
	let parts = null;
	let quoted = false;
	let index = 0;

	const append = (part) => {
		parts ??= [];
		parts.push(part);
	};

	const finishWord = () => {
		if (parts === null) return;
		tokens.push({ type: "word", parts, quoted });
		const previous = tokens.at(-2);
		if (previous?.type === "op" && HEREDOC_OPERATORS.has(previous.value)) {
			pendingHeredocs.push({
				delimiter: parts.map((part) => part.value ?? part.raw).join(""),
				stripTabs: previous.value === "<<-",
			});
		}
		parts = null;
		quoted = false;
	};

	const readVariable = () => {
		const match = VARIABLE.exec(source.slice(index));
		if (!match) return false;
		append({ type: "variable", name: match[1] ?? match[2], raw: match[0] });
		index += match[0].length;
		return true;
	};

	const readSingleQuoted = () => {
		const end = source.indexOf("'", index + 1);
		const stop = end === -1 ? source.length : end;
		append(literal(source.slice(index + 1, stop)));
		quoted = true;
		index = stop + 1;
	};

	const readDoubleQuoted = () => {
		append(literal(""));
		quoted = true;
		index += 1;
		while (index < source.length && source[index] !== '"') {
			const char = source[index];
			const next = source[index + 1];
			if (char === "\\" && next === "\n") {
				index += 2;
			} else if (char === "\\" && ESCAPABLE_IN_DOUBLE_QUOTES.has(next)) {
				append(literal(next));
				index += 2;
			} else if (char !== "$" || !readVariable()) {
				append(literal(char));
				index += 1;
			}
		}
		index += 1;
	};

	const skipHeredocBodies = () => {
		for (const { delimiter, stripTabs } of pendingHeredocs.splice(0)) {
			while (index < source.length) {
				const end = source.indexOf("\n", index);
				const stop = end === -1 ? source.length : end;
				const line = source.slice(index, stop);
				index = stop + 1;
				if ((stripTabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
			}
		}
	};

	const readOperator = () => {
		const operator = OPERATORS.find((op) => source.startsWith(op, index));
		if (!operator) return false;
		const isFileDescriptor =
			/^[<>]/.test(operator) &&
			!quoted &&
			parts?.every((part) => /^\d+$/.test(part.value ?? ""));
		if (isFileDescriptor) parts = null;
		finishWord();
		tokens.push({ type: "op", value: operator });
		index += operator.length;
		return true;
	};

	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];
		const startsWord = parts === null;
		if (char === "\n") {
			finishWord();
			tokens.push({ type: "op", value: "\n" });
			index += 1;
			skipHeredocBodies();
		} else if (char === " " || char === "\t" || char === "\r") {
			finishWord();
			index += 1;
		} else if (char === "#" && startsWord) {
			const end = source.indexOf("\n", index);
			index = end === -1 ? source.length : end;
		} else if (char === "\\") {
			if (next !== "\n") append(literal(next ?? ""));
			index += 2;
		} else if (char === "'") {
			readSingleQuoted();
		} else if (char === '"') {
			readDoubleQuoted();
		} else if (char === "~" && startsWord && /^(?:[/\s]|$)/.test(next ?? "")) {
			append({ type: "variable", name: "HOME", raw: "~" });
			index += 1;
		} else if (char === "$" && readVariable()) {
		} else if (!readOperator()) {
			append(literal(char));
			index += 1;
		}
	}
	finishWord();
	return tokens;
};
