import { Box, Text } from "ink";
import { useEffect, useState } from "react";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 80;

export const ThinkingIndicator = ({ isBusy }: { isBusy: boolean }) => {
	const [frameIndex, setFrameIndex] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
		}, FRAME_INTERVAL_MS);

		return () => clearInterval(timer);
	}, []);

	return (
		<>
			{isBusy ? (
				<Box paddingX={1} marginBottom={1} marginTop={1}>
					<Text color="cyan">{SPINNER_FRAMES[frameIndex]} Thinking...</Text>
				</Box>
			) : (
				<Box paddingX={1} marginBottom={1} marginTop={1}>
					<Text> </Text>
				</Box>
			)}
		</>
	);
};
