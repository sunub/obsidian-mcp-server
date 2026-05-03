import { useUIState } from "@cli/context/UIStateContext.js";
import { theme } from "@cli/theme/semantic-colors.js";
import { TransientMessageType } from "@cli/utils/events.js";
import { Box, Text } from "ink";
import type React from "react";

export const ToastDisplay: React.FC = () => {
	const { transientMessage } = useUIState();

	if (!transientMessage?.text) {
		return null;
	}

	if (transientMessage.type === TransientMessageType.Warning) {
		return (
			<Box justifyContent="flex-start" paddingTop={1}>
				<Text color={theme.status.warning}>{transientMessage.text}</Text>
			</Box>
		);
	}

	if (transientMessage.type === TransientMessageType.Hint) {
		return (
			<Box justifyContent="flex-start" paddingTop={1}>
				<Text color={theme.text.secondary}>{transientMessage.text}</Text>
			</Box>
		);
	}

	return null;
};
