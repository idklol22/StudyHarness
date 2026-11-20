/**
 * THEME COLOR MATH (all-themes wave): WCAG contrast, blending and the
 * per-theme subject-swatch lightness. Pure and browser-safe; the themes
 * table, the picker, the graph and tests/theme-contrast.test.ts share it.
 */

/** "#rgb" / "#rrggbb" → [r, g, b] 0–255. */
export function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
	return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}

/** [r, g, b] → "#rrggbb" (rounded, clamped). */
export function rgbToHex(rgb: readonly number[]): string {
	return `#${rgb.map((c) => Math.min(255, Math.max(0, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance of a #hex. */
export function relativeLuminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map((v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #hex colors (1–21, order-free). */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `top` laid over `base` at `alpha` (0–1) → #hex. */
export function blendHex(top: string, base: string, alpha: number): string {
	const t = hexToRgb(top);
	const b = hexToRgb(base);
	return rgbToHex(t.map((c, i) => c * alpha + b[i]! * (1 - alpha)));
}

/** "#hex" + alpha → "rgba(r, g, b, a)". */
export function rgba(hex: string, alpha: number): string {
	const [r, g, b] = hexToRgb(hex);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** hsl (h 0–360, s/l 0–100) → #hex. */
export function hslToHex(h: number, s: number, l: number): string {
	const sat = s / 100;
	const lig = l / 100;
	const k = (n: number) => (n + h / 30) % 12;
	const a = sat * Math.min(lig, 1 - lig);
	const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/** Subject swatches are `hsl(hue 26% L)` (src/core/study/colors.ts); L is per theme. */
export const SUBJECT_SATURATION = 26;
/** The classic lightness, kept wherever the surface is unknown (the planner API). */
export const SUBJECT_BASE_LIGHTNESS = 58;
/** The label text drawn in the swatch must read at AA on the surface. */
export const SUBJECT_MIN_CONTRAST = 4.5;

const lightnessMemo = new Map<string, number>();

/** The lightness at which EVERY hue's swatch reaches 4.5:1 on all the given
 *  surfaces (hence ≥ 3:1 as a mark too). Dark themes lift it from the base
 *  58 upward only when needed, light themes lower it. Memoised. */
export function subjectLightness(surfaces: readonly string[], mode: "dark" | "light"): number {
	const key = `${mode}|${surfaces.join(",")}`;
	const hit = lightnessMemo.get(key);
	if (hit !== undefined) return hit;
	const step = mode === "dark" ? 1 : -1;
	let l = SUBJECT_BASE_LIGHTNESS;
	for (; l > 8 && l < 94; l += step) {
		let ok = true;
		for (let h = 0; h < 360 && ok; h += 1) {
			const swatch = hslToHex(h, SUBJECT_SATURATION, l);
			for (const s of surfaces) if (contrastRatio(swatch, s) < SUBJECT_MIN_CONTRAST) { ok = false; break; }
		}
		if (ok) break;
	}
	lightnessMemo.set(key, l);
	return l;
}
