import { Box } from "ink";

export interface MarkdownDisplayProps {
	text: string;
	isPending: boolean;
	availableTerminalHeight?: number;
	terminalWidth: number;
	renderMarkdown?: boolean;
}

export function MarkdownDisplay(_props: MarkdownDisplayProps) {
	return <Box></Box>;
}
