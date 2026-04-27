/**
 * Shared color constants for the CLI UI.
 */
export const Colors = {
	Gray: "#808080",
	DimGray: "#696969",
	LightGray: "#d3d3d3",
	Cyan: "#00bcd4",
	Green: "#4caf50",
	Yellow: "#ffeb3b",
	Red: "#f44336",
	White: "#ffffff",
	Black: "#000000",
} as const;

export type ColorKey = keyof typeof Colors;
