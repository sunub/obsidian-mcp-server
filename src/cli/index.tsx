import { AppContainer } from "@cli/AppContainer.js";
import { registerSyncCleanup } from "@cli/utils/cleanup.js";
import { createWorkingStdio } from "@cli/utils/stdio.js";
import { render } from "ink";
import "dotenv/config";

async function start() {
	const wasRaw = process.stdin.isRaw;
	const { stdout: monkeyStdout, stderr: monkeySterr } = createWorkingStdio();
	if (!wasRaw && process.stdin.isTTY) {
		process.stdin.setRawMode(true);

		registerSyncCleanup(() => {
			process.stdin.setRawMode(wasRaw);
		});
	}

	process.stdin.resume();
	process.stdin.resume();

	const { waitUntilExit } = render(<AppContainer />, {
		stdout: monkeyStdout,
		stderr: monkeySterr,
		stdin: process.stdin,
		alternateBuffer: false,
	});

	await waitUntilExit();
}

start();
