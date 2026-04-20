import { render, Box, Text } from "ink";

function UserHistoryPrompt() {
  return (
    <Box flexDirection="column" padding={1} backgroundColor={"#313d4c"} >
      <Text bold color="#98FFD9">
        🕑 Conversation History:
      </Text>
      <Text color="#F1F5F9">
        - User: "What are the latest updates on the project?"
        {"\n"}- Assistant: "The latest update is that we have completed the initial design phase and are moving into development."
        {"\n"}- User: "Great! Can you summarize the key points from the design phase?"
        {"\n"}- Assistant: "Sure! The key points from the design phase include defining the project scope, creating wireframes, and establishing a technology stack."
      </Text>
    </Box>
  );
}

render(<UserHistoryPrompt />);
