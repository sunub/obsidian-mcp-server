// @ts-nocheck

import { render, Text } from "ink";
import { useMemo, useState } from "react";
import { InputContext } from "./context/InputContext.js";
import { KeypressProvider } from "./context/KeypressContext.js";
import { useTextBuffer } from "./key/text-buffer.js";
import { InputPrompt } from "./ui/InputPrompt.js";

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
