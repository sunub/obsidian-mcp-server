// @ts-nocheck

import { InputContext } from "@cli/context/InputContext.js";
import { KeypressProvider } from "@cli/context/KeypressContext.js";
import { useTextBuffer } from "@cli/key/text-buffer.js";
import { InputPrompt } from "@cli/ui/InputPrompt.js";
import { render, Text } from "ink";
import { useMemo, useState } from "react";

function App() {
	const [submitText, setSubmitText] = useState("");
	const buffer = useTextBuffer();

	const inputState = useMemo(
		() => ({
			buffer,
			userMessages: inputHistory,
			shellModeActive,
			showEscapePrompt,
			copyModeEnabled,
			inputWidth,
			suggestionsWidth,
		}),
		[buffer],
	);

	return (
		<KeypressProvider>
			<InputContext.Provider value={inputState}>
				<Text>You submitted: {submitText}</Text>
				<InputPrompt onSubmit={(text) => setSubmitText(text)} />
			</InputContext.Provider>
		</KeypressProvider>
	);
}
function start() {
	render(<App />);
}

start();
