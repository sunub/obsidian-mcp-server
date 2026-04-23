// import { Box, render, Text } from "ink";
// import { KeypressProvider } from "./context/KeypressContext.js";
// import { InputContext } from "./context/InputContext.js";
// import { useKeypress } from "./hooks/useKeypress.js";
// import { useEffect, useMemo, useState } from "react";
// import { useTextBuffer } from "./key/text-buffer.js";
// import { calculatePromptWidths, InputPrompt } from "./ui/InputPrompt.js";
// import { useTerminalSize } from "./hooks/useTerminalSize.js";
// import { useInputHistoryStore } from "./hooks/useInputHistory.js";
//
// function HistoryPrompt({
//   color = "blue",
//   content = "",
// }: {
//   color?: string;
//   content?: string;
// }) {
//   const [shellModeActive] = useState(false);
//   const [copyModeEnabled] = useState(false);
//   const [showEscapePrompt] = useState(false);
//
//   const { columns: terminalWidth, rows: terminalHeight } = useTerminalSize();
//   const mainAreaWidth = terminalWidth;
//
//   const { inputWidth, suggestionsWidth } = useMemo(() => {
//     const { inputWidth, suggestionsWidth } =
//       calculatePromptWidths(mainAreaWidth);
//     return { inputWidth, suggestionsWidth };
//   }, [mainAreaWidth]);
//   const availableTerminalHeight = Math.max(0, terminalHeight - 2);
//   const { inputHistory, addInput, initializeFromLogger } =
//     useInputHistoryStore();
//
//   const buffer = useTextBuffer({
//     initialText: "",
//     viewportWidth: inputWidth,
//     viewportHeight: availableTerminalHeight,
//   });
//
//   const inputState = useMemo(
//     () => ({
//       buffer,
//       userMessages: inputHistory,
//       shellModeActive,
//       showEscapePrompt,
//       copyModeEnabled,
//       inputWidth,
//       suggestionsWidth,
//     }),
//     [
//       buffer,
//       inputHistory,
//       shellModeActive,
//       showEscapePrompt,
//       copyModeEnabled,
//       inputWidth,
//       suggestionsWidth,
//     ],
//   );
//
//   const handleFinalSubmit = (value: string) => {
//     addInput(value);
//     console.log("Submitted:", value);
//   };
//
//   return (
//     <KeypressProvider>
//       <InputContext.Provider value={inputState}>
//         <InputPrompt
//           onSubmit={handleFinalSubmit}
//           focus={true}
//           placeholder={" Type your message..."}
//         />
//       </InputContext.Provider>
//     </KeypressProvider>
//   );
// }
//
// render(<HistoryPrompt />);
