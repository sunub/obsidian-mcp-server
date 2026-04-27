/*
 * 몽키 패칭을 수행하기 이전에 원래의 stdout과 stderr의 write 메서드를 저장합니다. 이렇게 하면 stdio가 패치된 이후에도 원래의 출력 스트림에 접근할 수 있습니다.
 */
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

/**
 * 몽키패칭에서 사용이 필요한 경우, 원래의 stdout과 stderr에 직접 쓰기 위해 이 함수를 사용합니다. stdio가 패치된 이후에도 원래의 출력 스트림에 접근할 수 있도록 합니다.
 */
export function writeToStdout(
	...args: Parameters<typeof process.stdout.write>
): boolean {
	return originalStdoutWrite(...args);
}

export function writeToStderr(
	...args: Parameters<typeof process.stderr.write>
): boolean {
	return originalStderrWrite(...args);
}

function isKey<T extends object>(
	key: string | symbol | number,
	obj: T,
): key is keyof T {
	return key in obj;
}

/**
 * Creates proxies for process.stdout and process.stderr that use the real write methods
 * (writeToStdout and writeToStderr) bypassing any monkey patching.
 * This is used to write to the real output even when stdio is patched.
 */
export function createWorkingStdio() {
	const stdoutHandler: ProxyHandler<typeof process.stdout> = {
		get(target, prop) {
			if (prop === "write") {
				return writeToStdout;
			}
			if (isKey(prop, target)) {
				const value = target[prop];
				if (typeof value === "function") {
					return value.bind(target);
				}
				return value;
			}
			return undefined;
		},
	};
	const inkStdout = new Proxy(process.stdout, stdoutHandler);

	const stderrHandler: ProxyHandler<typeof process.stderr> = {
		get(target, prop) {
			if (prop === "write") {
				return writeToStderr;
			}
			if (isKey(prop, target)) {
				const value = target[prop];
				if (typeof value === "function") {
					return value.bind(target);
				}
				return value;
			}
			return undefined;
		},
	};
	const inkStderr = new Proxy(process.stderr, stderrHandler);

	return { stdout: inkStdout, stderr: inkStderr };
}
