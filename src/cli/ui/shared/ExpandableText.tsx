import type { ReactElement } from "react";
import { Text } from "ink";

export const MAX_WIDTH = 120;

interface ExpandableTextProps {
	label: string;
	matchedIndex?: number;
	userInput?: string;
	textColor?: string;
	isExpanded?: boolean;
}

/**
 * Renders a suggestion label, highlighting the matched portion if provided.
 */
export function ExpandableText({
	label,
	matchedIndex,
	userInput,
	textColor,
	isExpanded: _isExpanded,
}: ExpandableTextProps): ReactElement {
	if (
		matchedIndex !== undefined &&
		matchedIndex >= 0 &&
		userInput &&
		userInput.length > 0
	) {
		const before = label.slice(0, matchedIndex);
		const match = label.slice(matchedIndex, matchedIndex + userInput.length);
		const after = label.slice(matchedIndex + userInput.length);
		return (
			<Text color={textColor}>
				{before}
				<Text bold>{match}</Text>
				{after}
			</Text>
		);
	}
	return <Text color={textColor}>{label}</Text>;
}
