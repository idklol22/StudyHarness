/**
 * The all-themes wave's readability gate: for every tuned theme (Mono + the
 * 14 LetCode themes) the WCAG thresholds of the theme brief, the scene veil,
 * the status inks and the per-theme subject swatches. Thresholds are the
 * brief's; fix the tokens, never lower them.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
	BUILTIN_THEMES,
	blendHex,
	contrastRatio,
	DEFAULT_THEME,
	deriveTune,
	hexToRgb,
	hslToHex,
	subjectLightness,
	SUBJECT_SATURATION,
	themeVars,
	tuneOf,
	type Theme,
} from "../src/core/index.ts";

const LETCODE_IDS = [
	"midnight", "smoke", "graphite", "contrast", "red", "orange", "ember", "emerald", "ocean", "sapphire", "citrus", "blue",
	"nimbus", "uzumaki",
];
const TUNED: Theme[] = [DEFAULT_THEME, ...LETCODE_IDS.map((id) => BUILTIN_THEMES.find((t) => t.id === id)!)];

describe("the LetCode theme set", () => {
	it("ships Mono (default) and all 14 LetCode ids, tuned", () => {
		assert.equal(DEFAULT_THEME.name, "Mono");
		for (const id of LETCODE_IDS) {
			const t = BUILTIN_THEMES.find((x) => x.id === id);
			assert.ok(t?.tune, `${id} is a built-in with its own tuning`);
		}
		assert.equal(BUILTIN_THEMES.find((t) => t.id === "blue")!.mode, "light");
		assert.equal(BUILTIN_THEMES.find((t) => t.id === "contrast")!.tune!.scene, "none");
		assert.equal(BUILTIN_THEMES.find((t) => t.id === "contrast")!.tune!.glass, false);
		assert.equal(BUILTIN_THEMES.find((t) => t.id === "contrast")!.tune!.focusWidth, 2);
		for (const [id, scene] of [["midnight", "dust"], ["smoke", "smoke"], ["nimbus", "clouds"], ["uzumaki", "swirl"]] as const) {
			assert.equal(BUILTIN_THEMES.find((t) => t.id === id)!.tune!.scene, scene);
		}
	});

	it("every theme emits every semantic role token", () => {
		for (const t of TUNED) {
			const v = themeVars(t.colors, t.mode, tuneOf(t));
			for (const k of [
				"--background", "--card", "--lh-surface-2", "--lh-raised", "--border", "--lh-border-strong", "--foreground",
				"--muted-foreground", "--lh-text-faint", "--lh-accent", "--lh-accent-contrast", "--lh-focus", "--lh-error",
				"--lh-success", "--lh-warning", "--lh-selection", "--lh-scrim", "--lh-shadow",
			]) assert.ok(v[k], `${t.id} ${k}`);
		}
	});

	it("the light theme has a real shadow, the contrast theme none, the others deep ones", () => {
		assert.match(tuneOf(BUILTIN_THEMES.find((t) => t.id === "blue")!).shadow, /0 1px 3px/);
		assert.equal(tuneOf(BUILTIN_THEMES.find((t) => t.id === "contrast")!).shadow, "none");
	});

	it("saturated themes: neutral muted text, and error is not the accent's hue", () => {
		const hueOf = (hex: string) => {
			const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
			const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
			if (!d) return 0;
			const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
			return (h * 60 + 360) % 360;
		};
		const sat = (hex: string) => {
			const [r, g, b] = hexToRgb(hex);
			return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
		};
		for (const id of ["red", "orange", "ember", "citrus"]) {
			const t = BUILTIN_THEMES.find((x) => x.id === id)!;
			assert.ok(sat(t.colors.textMuted) <= 0.2, `${id}: textMuted is not a tinted mush`);
			const dh = Math.abs(hueOf(t.colors.error) - hueOf(t.colors.accent));
			assert.ok(Math.min(dh, 360 - dh) >= 15, `${id}: error hue differs from the accent hue (${dh})`);
		}
		const red = BUILTIN_THEMES.find((x) => x.id === "red")!;
		assert.ok(hueOf(red.colors.error) > 300 || hueOf(red.colors.error) < 20, "red's error is magenta/pink");
		assert.ok(hueOf(red.colors.error) > 300, "red's error leans magenta, away from the red accent");
	});
});

describe("contrast: every tuned theme", () => {
	for (const t of TUNED) {
		it(t.id, () => {
			const c = t.colors;
			const u = tuneOf(t);
			const surfaces = { bg: c.background, surface: c.surface, surface2: u.surface2, raised: u.raised };
			const ge = (what: string, a: string, b: string, min: number) => {
				const r = contrastRatio(a, b);
				assert.ok(r >= min, `${t.id}: ${what} ${a} on ${b} = ${r.toFixed(2)} (< ${min})`);
			};
			ge("text/bg", c.text, surfaces.bg, 7);
			ge("text/surface", c.text, surfaces.surface, 7);
			ge("text/surface-2", c.text, surfaces.surface2, 7);
			ge("text/raised", c.text, surfaces.raised, 7);
			for (const [n, s] of Object.entries(surfaces)) {
				ge(`text-muted/${n}`, c.textMuted, s, 4.5);
				ge(`text-faint/${n}`, u.textFaint, s, 3);
				ge(`border-strong/${n}`, u.borderStrong, s, 3);
				ge(`focus/${n}`, u.focus, s, 3);
				for (const [k, ink] of [["error", c.error], ["success", c.success], ["warning", c.warning]] as const) {
					ge(`${k} ink/${n}`, ink, s, 4.5);
				}
			}
			ge("accent-contrast/accent", u.accentContrast, c.accent, 4.5);
			const selAlpha = Number(/([\d.]+)\)$/.exec(u.selection)![1]);
			ge("text/selection", c.text, blendHex(c.accent, surfaces.surface, selAlpha), 4.5);
			ge("bold ink/bg", c.bold, surfaces.bg, 7);
			ge("code ink/surface", c.code, surfaces.surface, 7);
		});
	}
});

describe("scenes: text stays readable over the brightest scene pixel under the veil", () => {
	for (const t of TUNED.filter((x) => tuneOf(x).scene !== "none")) {
		it(t.id, () => {
			const u = tuneOf(t);
			// The veil (background at scrimAlpha) over the brightest scene pixel.
			const veiled = blendHex(t.colors.background, u.scenePeak, u.scrimAlpha);
			assert.ok(contrastRatio(t.colors.text, veiled) >= 7, `${t.id}: text over scene ${contrastRatio(t.colors.text, veiled).toFixed(2)}`);
			assert.ok(contrastRatio(t.colors.textMuted, veiled) >= 4.5, `${t.id}: muted over scene ${contrastRatio(t.colors.textMuted, veiled).toFixed(2)}`);
			assert.ok(contrastRatio(u.textFaint, veiled) >= 3, `${t.id}: faint over scene`);
		});
	}
	it("glass is only ever on a theme with a scene or a vivid accent glow, never on contrast or light themes", () => {
		for (const t of TUNED) if (t.id === "contrast" || t.mode === "light") assert.equal(tuneOf(t).glass, false, t.id);
	});
});

describe("subject colours adjust per theme", () => {
	for (const t of TUNED) {
		it(`${t.id}: every hue's swatch is >= 4.5:1 (hence >= 3:1) on the surfaces`, () => {
			const u = tuneOf(t);
			const surfaces = [t.colors.surface, t.colors.background, u.surface2];
			const l = subjectLightness(surfaces, t.mode);
			assert.equal(themeVars(t.colors, t.mode, u)["--lh-subject-l"], `${l}%`);
			for (let h = 0; h < 360; h++) {
				const swatch = hslToHex(h, SUBJECT_SATURATION, l);
				for (const s of surfaces) {
					assert.ok(contrastRatio(swatch, s) >= 4.5, `${t.id} hue ${h} L${l} on ${s}: ${contrastRatio(swatch, s).toFixed(2)}`);
				}
			}
		});
	}
	it("light themes lower the lightness, dark ones never go below the classic 58", () => {
		const blue = BUILTIN_THEMES.find((t) => t.id === "blue")!;
		const bl = subjectLightness([blue.colors.surface, blue.colors.background, tuneOf(blue).surface2], "light");
		assert.ok(bl < 58, `light lightness ${bl}`);
		const mid = BUILTIN_THEMES.find((t) => t.id === "midnight")!;
		assert.ok(subjectLightness([mid.colors.surface, mid.colors.background, tuneOf(mid).surface2], "dark") >= 58);
	});
});

describe("derived tuning (imported themes)", () => {
	it("a theme without its own tuning still defines every token and passes the core thresholds", () => {
		for (const t of BUILTIN_THEMES.filter((x) => !TUNED.includes(x))) {
			const u = deriveTune(t.colors, t.mode);
			assert.ok(u.surface2 && u.raised && u.borderStrong && u.textFaint && u.accentContrast && u.focus, t.id);
			assert.ok(contrastRatio(u.accentContrast, t.colors.accent) >= 3, `${t.id} accent-contrast`);
		}
	});
});

describe("the Mono literals in app/globals.css", () => {
	it("match the Mono tuning", () => {
		const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
		const start = css.indexOf(":root,\n.dark {");
		const body = css.slice(start, css.indexOf("}", start));
		for (const [token, value] of Object.entries(themeVars(DEFAULT_THEME.colors, "dark", tuneOf(DEFAULT_THEME)))) {
			const m = new RegExp(`${token}:\\s*([^;]+);`).exec(body);
			assert.equal(m?.[1]?.trim(), value, token);
		}
	});
});
