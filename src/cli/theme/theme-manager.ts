/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from "node:process";
import {
	DEFAULT_BACKGROUND_OPACITY,
	DEFAULT_BORDER_OPACITY,
	DEFAULT_INPUT_BACKGROUND_OPACITY,
	DEFAULT_SELECTION_OPACITY,
} from "@cli/constants.js";
import { DefaultDark } from "@cli/theme/builtin/default-dark.js";
import { NoColorTheme } from "@cli/theme/builtin/no-color.js";
import { TokyoNight } from "@cli/theme/builtin/tokyonight-dark.js";
import type { SemanticColors } from "@cli/theme/semantic-tokens.js";
import type { ColorsTheme, Theme, ThemeType } from "@cli/theme/theme.js";
import {
	getThemeTypeFromBackgroundColor,
	interpolateColor,
	resolveColor,
} from "@cli/theme/theme.js";

export interface ThemeDisplay {
	name: string;
	type: ThemeType;
}

// 기본 테마를 TokyoNight으로 설정
export const DEFAULT_THEME: Theme = TokyoNight;

class ThemeManager {
	private readonly availableThemes: Theme[];
	private activeTheme: Theme;
	private terminalBackground: string | undefined;

	// Cache for dynamic colors
	private cachedColors: ColorsTheme | undefined;
	private cachedSemanticColors: SemanticColors | undefined;
	private lastCacheKey: string | undefined;

	constructor() {
		// 고정된 테마 리스트
		this.availableThemes = [TokyoNight, DefaultDark];
		this.activeTheme = DEFAULT_THEME;
	}

	setTerminalBackground(color: string | undefined): void {
		if (this.terminalBackground !== color) {
			this.terminalBackground = color;
			this.clearCache();
		}
	}

	getTerminalBackground(): string | undefined {
		return this.terminalBackground;
	}

	private clearCache(): void {
		this.cachedColors = undefined;
		this.cachedSemanticColors = undefined;
		this.lastCacheKey = undefined;
	}

	setActiveTheme(themeName: string | undefined): boolean {
		if (!themeName) {
			this.activeTheme = DEFAULT_THEME;
			this.clearCache();
			return true;
		}

		const theme = this.availableThemes.find((t) => t.name === themeName);
		if (!theme) {
			return false;
		}

		if (this.activeTheme !== theme) {
			this.activeTheme = theme;
			this.clearCache();
		}
		return true;
	}

	getActiveTheme(): Theme {
		if (process.env["NO_COLOR"]) {
			return NoColorTheme;
		}

		// 현재 테마가 유효한지 확인 후 반환, 아니면 기본값
		const isValid = this.availableThemes.some(
			(t) => t.name === this.activeTheme.name,
		);
		if (!isValid) {
			this.activeTheme = DEFAULT_THEME;
		}

		return this.activeTheme;
	}

	getColors(): ColorsTheme {
		const activeTheme = this.getActiveTheme();
		const cacheKey = `${activeTheme.name}:${this.terminalBackground}`;
		if (this.cachedColors && this.lastCacheKey === cacheKey) {
			return this.cachedColors;
		}

		const colors = activeTheme.colors;
		if (
			this.terminalBackground &&
			this.isThemeCompatible(activeTheme, this.terminalBackground)
		) {
			this.cachedColors = {
				...colors,
				Background: this.terminalBackground,
				DarkGray: interpolateColor(
					this.terminalBackground,
					colors.Gray,
					DEFAULT_BORDER_OPACITY,
				),
				InputBackground: interpolateColor(
					this.terminalBackground,
					colors.Gray,
					DEFAULT_INPUT_BACKGROUND_OPACITY,
				),
				MessageBackground: interpolateColor(
					this.terminalBackground,
					colors.Gray,
					DEFAULT_BACKGROUND_OPACITY,
				),
				FocusBackground: interpolateColor(
					this.terminalBackground,
					activeTheme.colors.Brand ??
						activeTheme.colors.FocusColor ??
						activeTheme.colors.AccentGreen,
					DEFAULT_SELECTION_OPACITY,
				),
			};
		} else {
			this.cachedColors = colors;
		}

		this.lastCacheKey = cacheKey;
		return this.cachedColors;
	}

	getSemanticColors(): SemanticColors {
		const activeTheme = this.getActiveTheme();
		const cacheKey = `${activeTheme.name}:${this.terminalBackground}`;
		if (this.cachedSemanticColors && this.lastCacheKey === cacheKey) {
			return this.cachedSemanticColors;
		}

		const semanticColors = activeTheme.semanticColors;
		if (
			this.terminalBackground &&
			this.isThemeCompatible(activeTheme, this.terminalBackground)
		) {
			const colors = this.getColors();
			this.cachedSemanticColors = {
				...semanticColors,
				background: {
					...semanticColors.background,
					primary: this.terminalBackground,
					message: colors.MessageBackground ?? "",
					input: colors.InputBackground ?? "",
					focus: colors.FocusBackground ?? "",
				},
				border: {
					...semanticColors.border,
					default: colors.DarkGray,
				},
				ui: {
					...semanticColors.ui,
					dark: colors.DarkGray,
					focus: colors.Brand ?? colors.FocusColor ?? colors.AccentGreen,
				},
			};
		} else {
			this.cachedSemanticColors = semanticColors;
		}

		this.lastCacheKey = cacheKey;
		return this.cachedSemanticColors;
	}

	isThemeCompatible(
		activeTheme: Theme,
		terminalBackground: string | undefined,
	): boolean {
		if (activeTheme.type === "ansi") {
			return true;
		}

		const backgroundType = getThemeTypeFromBackgroundColor(terminalBackground);
		if (!backgroundType) {
			return true;
		}

		const themeType =
			activeTheme.type === "custom"
				? getThemeTypeFromBackgroundColor(
						resolveColor(activeTheme.colors.Background) ||
							activeTheme.colors.Background,
					)
				: activeTheme.type;

		return themeType === backgroundType;
	}

	getAvailableThemes(): ThemeDisplay[] {
		return this.availableThemes.map((theme) => ({
			name: theme.name,
			type: theme.type,
		}));
	}
}

export const themeManager = new ThemeManager();
