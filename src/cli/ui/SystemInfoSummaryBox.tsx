import { Box } from "ink";
import type React from "react";
import { ToastDisplay } from "./ToastDisplay.js";

interface SystemInfoSummaryBoxProps {
	children: React.ReactNode;
}

export function SystemInfoSummaryBox({ children }: SystemInfoSummaryBoxProps) {
	return (
		<Box width={"100%"} flexDirection="column" padding={0}>
			<ToastDisplay />
			<Box
				width={"100%"}
				flexDirection="row"
				justifyContent="space-between"
				alignItems="center"
			>
				{children}
			</Box>
		</Box>
	);
}
