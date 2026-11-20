/**
 * The subject colour adapter: a learner's hue (or the automatic golden-angle hue from study/map.ts)
 * as the one CSS colour used everywhere a subject is shown. Pure and browser-safe, so both the shell
 * and server routes can use the same helper.
 */
export function subjectColorCss(hue: number, lightness = 58): string {
	return `hsl(${Math.round(hue) % 360} 26% ${lightness}%)`;
}
