import React from "react";
import { useState, useEffect } from "react";
import { Box, Text } from "ink";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 80;

export const ThinkingIndicator: React.FC = () => {
	const [frameIndex, setFrameIndex] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
		}, FRAME_INTERVAL_MS);

		return () => clearInterval(timer);
	}, []);

	return (
		<Box paddingX={1} marginBottom={1}>
			<Text color="cyan">{SPINNER_FRAMES[frameIndex]} Thinking...</Text>
		</Box>
	);
};
