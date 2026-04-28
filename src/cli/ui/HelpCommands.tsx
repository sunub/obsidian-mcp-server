import { SLASH_COMMANDS } from "@cli/constants.js";
import { Box, Text } from "ink";
import tools from "@/tools/index.js";

interface ToolInfo {
	name: string;
	shorthandDescription: {
		en: string;
		ko: string;
	};
}

interface HelpCommandsProps {
	width?: number;
}

export function HelpCommands({ width }: HelpCommandsProps) {
	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor="gray"
			width={width ? width - 2 : undefined}
		>
			<Text bold color="yellow">
				💡 Slash Commands:
			</Text>
			{SLASH_COMMANDS.map((item) => (
				<Box key={item.command} marginLeft={2}>
					<Box width={20}>
						<Text color="cyan">{item.command}</Text>
					</Box>
					<Text>— {item.desc}</Text>
				</Box>
			))}

			<Box marginTop={1}>
				<Text bold color="yellow">
					🛠 MCP Tools (Internal):
				</Text>
			</Box>
			{Object.entries(tools).map(([name, info]) => {
				const tool = info as unknown as ToolInfo;
				return (
					<Box key={name} flexDirection="column" marginLeft={2} marginTop={0}>
						<Text color="magenta">{tool.name}</Text>
						<Box marginLeft={2}>
							<Text color="gray" italic>
								{tool.shorthandDescription.en}
							</Text>
						</Box>
					</Box>
				);
			})}

			<Box marginTop={1}>
				<Text color="gray">
					자연어 질문은 슬래시 없이 입력하면 RAG 기반으로 답변합니다.
				</Text>
			</Box>
		</Box>
	);
}
