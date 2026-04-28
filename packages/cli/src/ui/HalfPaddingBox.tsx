/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box } from "ink";
import type React from "react";

export interface HalfLinePaddedBoxProps {
	backgroundBaseColor: string;
	backgroundOpacity: number;
	useBackgroundColor?: boolean;
	children: React.ReactNode;
}

export const HalfLinePaddedBox: React.FC<HalfLinePaddedBoxProps> = (props) => {
	return <Box flexDirection="column">{props.children}</Box>;
};
