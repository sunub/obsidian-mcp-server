import { renderBootLogo } from "@cli/utils/bootLogo.js";
import { registerSyncCleanup } from "@cli/utils/cleanup.js";
import { createWorkingStdio } from "@cli/utils/stdio.js";
import { render } from "ink";
import { TerminalInfoProvider } from "ink-picture";
import { AppContainer } from "./AppContainer.js";
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

	await renderBootLogo(monkeyStdout);

	const inkOptions = {
		stdout: monkeyStdout,
		stderr: monkeySterr,
		stdin: process.stdin,
		alternateBuffer: false,
	} as const;

	const { waitUntilExit } = render(
		<TerminalInfoProvider>
			<AppContainer />
		</TerminalInfoProvider>,
		inkOptions,
	);

	await waitUntilExit();
}

start();
