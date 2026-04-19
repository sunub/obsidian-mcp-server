import React from "react";
import { Box, Text } from "ink";
import type { HistoryItem, ContentRenderer } from "../types.js";

/** 기본 content 렌더러: 향후 마크다운 렌더링으로 교체 가능 */
const renderPlainText: ContentRenderer = (content: string, _width: number) =>
  content;

interface HistoryItemDisplayProps {
  item: HistoryItem;
  width: number;
  contentRenderer?: ContentRenderer;
}

const LABEL_MAP: Record<HistoryItem["type"], { label: string; color: string }> =
{
  user: { label: "▶ You", color: "green" },
  assistant: { label: "◀ Assistant", color: "cyan" },
  error: { label: "✖ Error", color: "red" },
  info: { label: "ℹ Info", color: "yellow" },
};

export const HistoryItemDisplay: React.FC<HistoryItemDisplayProps> = ({
  item,
  width,
  contentRenderer = renderPlainText,
}) => {
  const { label, color } = LABEL_MAP[item.type];

  return (
    <Box flexDirection="column" width={width} paddingX={1} marginBottom={1}>
      <Text color={color} bold>
        {label}
      </Text>
      <Text wrap="wrap">{contentRenderer(item.content, width)}</Text>
    </Box>
  );
};
