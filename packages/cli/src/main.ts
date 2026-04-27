process.on("uncaughtException", (error) => {
	if (
		process.platform === "win32" &&
		error instanceof Error &&
		error.message === "Cannot resize a pty that has already exited."
	) {
		// This error happens on Windows with node-pty when resizing a pty that has just exited.
		// It is a race condition in node-pty that we cannot prevent, so we silence it.
		return;
	}

	if (error instanceof Error) {
		process.stderr.write(`${error.stack} + '\n'`);
	} else {
		process.stderr.write(`${error} + '\n'`);
	}
	process.exit(1);
});

async function run() {}

run();
