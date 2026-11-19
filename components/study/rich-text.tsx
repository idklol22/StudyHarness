/**
 * Text with LaTeX maths for the notes and flashcards (owner 2026-11-19: "represent maths in LaTeX"): `$…$` renders
 * inline and `$$…$$` as a displayed equation, through KaTeX (the same engine as the chat; its CSS is loaded in
 * app/layout.tsx). Everything else stays plain text. A formula KaTeX cannot parse shows its source, never an error.
 */
import katex from "katex";
import type { CSSProperties } from "react";

const MATH = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;

/** Split into text and maths pieces (exported for tests). */
export function mathPieces(text: string): Array<{ kind: "text" | "inline" | "display"; value: string }> {
	const out: Array<{ kind: "text" | "inline" | "display"; value: string }> = [];
	let last = 0;
	for (const m of text.matchAll(MATH)) {
		if (m.index! > last) out.push({ kind: "text", value: text.slice(last, m.index) });
		const raw = m[0];
		out.push(raw.startsWith("$$") ? { kind: "display", value: raw.slice(2, -2).trim() } : { kind: "inline", value: raw.slice(1, -1).trim() });
		last = m.index! + raw.length;
	}
	if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
	return out;
}

export const renderLatex = (latex: string, display: boolean): string =>
	katex.renderToString(latex, { displayMode: display, throwOnError: false, output: "html", strict: false, trust: false });

export function RichText({ text, style }: { text: string; style?: CSSProperties }) {
	return (
		<span style={style}>
			{mathPieces(text).map((p, i) => p.kind === "text"
				? <span key={i}>{p.value}</span>
				// KaTeX's own output (trust disabled), like components/latex-glyph.tsx
				: <span key={i} className={p.kind === "display" ? "block" : undefined} style={p.kind === "display" ? { display: "block", margin: "4px 0", fontFamily: "initial" } : { fontFamily: "initial" }} dangerouslySetInnerHTML={{ __html: renderLatex(p.value, p.kind === "display") }} />)}
		</span>
	);
}
