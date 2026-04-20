import type { SemanticColors } from "./semantic-tokens.js";
import { themeManager } from "./theme-manager.js";

export const theme: SemanticColors = {
	get text() {
		return themeManager.getSemanticColors().text;
	},
	get background() {
		return themeManager.getSemanticColors().background;
	},
	get border() {
		return themeManager.getSemanticColors().border;
	},
	get ui() {
		return themeManager.getSemanticColors().ui;
	},
	get status() {
		return themeManager.getSemanticColors().status;
	},
};
