import { Box, render, Text } from "ink";

function HistoryPrompt({
	color = "blue",
	content = "",
}: {
	color?: string;
	content?: string;
}) {
	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="#98FFD9">
				🕑 Conversation History:
			</Text>
			<Text color="magenta">
				- User: "What are the latest updates on the project?"
				{"\n"}- Assistant: "The latest update is that we have completed the
				initial design phase and are moving into development."
				{"\n"}- User: "Great! Can you summarize the key points from the design
				phase?"
				{"\n"}- Assistant: "Sure! The key points from the design phase include
				defining the project scope, creating wireframes, and establishing a
				technology stack."
			</Text>
			{content && <Text color={color}>{content}</Text>}
		</Box>
	);
}

render(<HistoryPrompt />);

//generate_property 내 vault 에서 "VectorDB"라는 이름을 가진 문서의 내용을 읽고 frontmatter 를 작성해줘
