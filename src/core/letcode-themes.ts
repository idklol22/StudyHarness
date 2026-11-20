/**
 * The LetCode themes (all-themes wave): midnight, smoke, graphite, contrast,
 * red, orange, ember, emerald, ocean, sapphire, citrus, blue, nimbus and
 * uzumaki, with the same names as LetCode's web/theme.js so a later setting
 * can sync between the apps. Each is hand-tuned, not a hue swap:
 *
 *  - light (blue): darker borders, a real shadow, a deeper accent;
 *  - saturated (red, orange, ember, citrus): a NEUTRAL muted text (not tinted
 *    mush) and an error color that is not the accent's hue (red's error is
 *    magenta-pink);
 *  - contrast: pure black/white, 2px focus, no glass, no scene;
 *  - scene themes (midnight, smoke, nimbus, uzumaki): glass tiles + a veil.
 *
 * tests/theme-contrast.test.ts enforces the thresholds on every one.
 */
import type { ThemeColors, ThemeMode, ThemeTune } from "./themes.ts";

export interface ThemeSpec {
	name: string;
	mode: ThemeMode;
	colors: ThemeColors;
	tune: ThemeTune;
}

const DARK_SHADOW = "0 18px 50px rgba(0, 0, 0, 0.55)";
const SCENE_SHADOW = "0 20px 60px rgba(0, 0, 0, 0.65)";

export const LETCODE_THEMES: readonly ThemeSpec[] = [
	{
		name: "Midnight", mode: "dark",
		colors: {
			background: "#060606", accent: "#d8d8da", surface: "#0e0e0f", bold: "#f2f2f2", border: "#2a2a2d", italic: "#d8d8da",
			text: "#f2f2f2", code: "#e4e4e6", textMuted: "#a9a9ab", error: "#e58a85", success: "#9fc4ad", warning: "#cdb98e",
		},
		tune: {
			surface2: "#151516", raised: "#1e1e20", borderStrong: "#6d6d72", textFaint: "#85858a", accentContrast: "#070707",
			focus: "#d8d8da", focusWidth: 1.5, selection: "rgba(216, 216, 218, 0.30)", scrimAlpha: 0.82, shadow: SCENE_SHADOW,
			scene: "dust", glass: true, scenePeak: "#ebebeb",
		},
	},
	{
		name: "Smoke", mode: "dark",
		colors: {
			background: "#060606", accent: "#d8d8da", surface: "#0e0e0f", bold: "#f2f2f2", border: "#2a2a2d", italic: "#c4c4c7",
			text: "#f2f2f2", code: "#e4e4e6", textMuted: "#a9a9ab", error: "#e58a85", success: "#9fc4ad", warning: "#cdb98e",
		},
		tune: {
			surface2: "#151516", raised: "#1e1e20", borderStrong: "#6d6d72", textFaint: "#85858a", accentContrast: "#070707",
			focus: "#d8d8da", focusWidth: 1.5, selection: "rgba(216, 216, 218, 0.30)", scrimAlpha: 0.7, shadow: SCENE_SHADOW,
			scene: "smoke", glass: true, scenePeak: "#9a9a9c",
		},
	},
	{
		name: "Graphite", mode: "dark",
		colors: {
			background: "#1c1d20", accent: "#e8e8ea", surface: "#232427", bold: "#f4f4f6", border: "#3b3c42", italic: "#cfd0d6",
			text: "#e8e8ea", code: "#e8e8ea", textMuted: "#aeb0b6", error: "#ea8a8f", success: "#8fc6a0", warning: "#d9b36c",
		},
		tune: {
			surface2: "#2a2b2f", raised: "#34353a", borderStrong: "#80838c", textFaint: "#8d9099", accentContrast: "#1c1d20",
			focus: "#e8e8ea", focusWidth: 1.5, selection: "rgba(232, 232, 234, 0.26)", scrimAlpha: 0.8, shadow: "0 18px 50px rgba(0, 0, 0, 0.4)",
			scene: "none", glass: false, scenePeak: "#1c1d20",
		},
	},
	{
		name: "Contrast", mode: "dark",
		colors: {
			background: "#000000", accent: "#ffe066", surface: "#000000", bold: "#ffffff", border: "#8a8a8a", italic: "#ffffff",
			text: "#ffffff", code: "#ffffff", textMuted: "#e2e2e2", error: "#ff7a8a", success: "#5dffa0", warning: "#ffd24a",
		},
		tune: {
			surface2: "#0d0d0d", raised: "#1a1a1a", borderStrong: "#c8c8c8", textFaint: "#b4b4b4", accentContrast: "#000000",
			focus: "#ffe066", focusWidth: 2, selection: "rgba(255, 224, 102, 0.40)", scrimAlpha: 1, shadow: "none",
			scene: "none", glass: false, scenePeak: "#000000",
		},
	},
	{
		name: "Red", mode: "dark",
		colors: {
			background: "#0b0707", accent: "#d7301a", surface: "#130c0c", bold: "#f6ece8", border: "#3a2422", italic: "#e8c4bb",
			text: "#eee6e1", code: "#f0c9bd", textMuted: "#aea8a4", error: "#ff7ab8", success: "#8fc9a0", warning: "#e8a85c",
		},
		tune: {
			surface2: "#1b1010", raised: "#271716", borderStrong: "#80706c", textFaint: "#8a8380", accentContrast: "#ffffff",
			focus: "#ff6a52", focusWidth: 1.5, selection: "rgba(215, 48, 26, 0.38)", scrimAlpha: 0.8, shadow: DARK_SHADOW,
			scene: "none", glass: false, scenePeak: "#0b0707",
		},
	},
	{
		name: "Orange", mode: "dark",
		colors: {
			background: "#0b0805", accent: "#ff8a1a", surface: "#130e08", bold: "#f8efe3", border: "#3a2c1a", italic: "#f0d2a8",
			text: "#f2ebe2", code: "#ffcf99", textMuted: "#b0aaa2", error: "#ff6b8a", success: "#9fcf9a", warning: "#f2c14e",
		},
		tune: {
			surface2: "#1b140b", raised: "#281d10", borderStrong: "#82776a", textFaint: "#8c867e", accentContrast: "#1a0d00",
			focus: "#ff9a2e", focusWidth: 1.5, selection: "rgba(255, 138, 26, 0.34)", scrimAlpha: 0.8, shadow: DARK_SHADOW,
			scene: "none", glass: false, scenePeak: "#0b0805",
		},
	},
	{
		name: "Ember", mode: "dark",
		colors: {
			background: "#140a07", accent: "#ff7a45", surface: "#21110b", bold: "#fff3ec", border: "#4a2c1e", italic: "#ffc8b0",
			text: "#fff3ec", code: "#ffcfb8", textMuted: "#c7b8b0", error: "#ff6fa0", success: "#b5e48c", warning: "#ffc04d",
		},
		tune: {
			surface2: "#2c1710", raised: "#3a1f15", borderStrong: "#8d7064", textFaint: "#9d8478", accentContrast: "#1c0700",
			focus: "#ff9466", focusWidth: 1.5, selection: "rgba(255, 122, 69, 0.34)", scrimAlpha: 0.78, shadow: DARK_SHADOW,
			scene: "none", glass: true, scenePeak: "#140a07",
		},
	},
	{
		name: "Emerald", mode: "dark",
		colors: {
			background: "#04110c", accent: "#2ee59d", surface: "#0a1d15", bold: "#eafff6", border: "#20483a", italic: "#a8f0cf",
			text: "#eafff6", code: "#b9f5da", textMuted: "#a3c9b8", error: "#ff8f8f", success: "#8af5c9", warning: "#ffd166",
		},
		tune: {
			surface2: "#0f281d", raised: "#163628", borderStrong: "#5d8f7c", textFaint: "#7aa492", accentContrast: "#02130c",
			focus: "#2ee59d", focusWidth: 1.5, selection: "rgba(46, 229, 157, 0.30)", scrimAlpha: 0.78, shadow: DARK_SHADOW,
			scene: "none", glass: true, scenePeak: "#04110c",
		},
	},
	{
		name: "Ocean", mode: "dark",
		colors: {
			background: "#041218", accent: "#22d3ee", surface: "#08202a", bold: "#e9fbff", border: "#1f5266", italic: "#a6ecf8",
			text: "#e9fbff", code: "#b4f0fb", textMuted: "#9fc6d1", error: "#fb7185", success: "#5eead4", warning: "#fcd34d",
		},
		tune: {
			surface2: "#0c2b37", raised: "#123846", borderStrong: "#5f93a5", textFaint: "#76a1b0", accentContrast: "#021116",
			focus: "#22d3ee", focusWidth: 1.5, selection: "rgba(34, 211, 238, 0.30)", scrimAlpha: 0.78, shadow: DARK_SHADOW,
			scene: "none", glass: true, scenePeak: "#041218",
		},
	},
	{
		name: "Sapphire", mode: "dark",
		colors: {
			background: "#070b1a", accent: "#4da3ff", surface: "#0d1430", bold: "#eef3ff", border: "#2a3a6e", italic: "#b8d4ff",
			text: "#eef3ff", code: "#c4dbff", textMuted: "#a9b6dc", error: "#ff7a8a", success: "#5fd3a5", warning: "#ffc66d",
		},
		tune: {
			surface2: "#131c3d", raised: "#1b2650", borderStrong: "#6475ad", textFaint: "#8190bf", accentContrast: "#04101f",
			focus: "#4da3ff", focusWidth: 1.5, selection: "rgba(77, 163, 255, 0.32)", scrimAlpha: 0.78, shadow: DARK_SHADOW,
			scene: "none", glass: true, scenePeak: "#070b1a",
		},
	},
	{
		name: "Citrus", mode: "dark",
		colors: {
			background: "#0e1206", accent: "#c6f432", surface: "#171d0a", bold: "#f8ffe8", border: "#3d4a1e", italic: "#e2f59a",
			text: "#f8ffe8", code: "#e8f9b0", textMuted: "#c3c9ae", error: "#ff8a8a", success: "#a6e87a", warning: "#ffd23f",
		},
		tune: {
			surface2: "#1f270e", raised: "#2a3414", borderStrong: "#7d8c52", textFaint: "#97a272", accentContrast: "#141a00",
			focus: "#c6f432", focusWidth: 1.5, selection: "rgba(198, 244, 50, 0.30)", scrimAlpha: 0.78, shadow: DARK_SHADOW,
			scene: "none", glass: true, scenePeak: "#0e1206",
		},
	},
	{
		name: "Blue", mode: "light",
		colors: {
			background: "#f5f8fe", accent: "#1d5fe0", surface: "#ffffff", bold: "#0b2a6e", border: "#aebfe0", italic: "#2a4f9c",
			text: "#0b2a6e", code: "#123e9c", textMuted: "#40629f", error: "#c4282f", success: "#16704a", warning: "#8f5a00",
		},
		tune: {
			surface2: "#eef3fc", raised: "#e1eafa", borderStrong: "#5f7db8", textFaint: "#6683b8", accentContrast: "#ffffff",
			focus: "#1d5fe0", focusWidth: 2, selection: "rgba(29, 95, 224, 0.22)", scrimAlpha: 0.85,
			shadow: "0 14px 40px rgba(20, 60, 140, 0.18), 0 1px 3px rgba(20, 60, 140, 0.12)",
			scene: "none", glass: false, scenePeak: "#f5f8fe",
		},
	},
	{
		name: "Nimbus", mode: "dark",
		colors: {
			background: "#05060f", accent: "#f1eddb", surface: "#0b0c16", bold: "#f1eddb", border: "#2b2d3c", italic: "#d4d0bd",
			text: "#f1eddb", code: "#dcd8c4", textMuted: "#aca897", error: "#e39a8e", success: "#b9c7a5", warning: "#dcc896",
		},
		tune: {
			surface2: "#11131f", raised: "#1a1c2a", borderStrong: "#6e7080", textFaint: "#88867c", accentContrast: "#05060f",
			focus: "#f1eddb", focusWidth: 1.5, selection: "rgba(241, 237, 219, 0.26)", scrimAlpha: 0.8, shadow: SCENE_SHADOW,
			scene: "clouds", glass: true, scenePeak: "#f1eddb",
		},
	},
	{
		name: "Uzumaki", mode: "dark",
		colors: {
			background: "#0b0b0a", accent: "#c9a66b", surface: "#121210", bold: "#ebe6da", border: "#2e2d28", italic: "#d8cfbb",
			text: "#ebe6da", code: "#d9cdb3", textMuted: "#aaa497", error: "#d6907a", success: "#a3b08f", warning: "#c9a66b",
		},
		tune: {
			surface2: "#191916", raised: "#23221e", borderStrong: "#72705f", textFaint: "#857f72", accentContrast: "#11100d",
			focus: "#c9a66b", focusWidth: 1.5, selection: "rgba(201, 166, 107, 0.30)", scrimAlpha: 0.8, shadow: SCENE_SHADOW,
			scene: "swirl", glass: true, scenePeak: "#ebe4d4",
		},
	},
];
