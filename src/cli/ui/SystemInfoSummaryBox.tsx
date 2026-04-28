import { Box } from "ink";
import type React from "react";

interface SystemInfoSummaryBoxProps {
	children: React.ReactNode;
}

export function SystemInfoSummaryBox({ children }: SystemInfoSummaryBoxProps) {
	return (
		<Box width={"100%"} justifyContent="space-between">
			{children}
		</Box>
	);
}
