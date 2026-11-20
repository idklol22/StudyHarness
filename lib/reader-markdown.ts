/**
 * Markdown-vs-plain decision for the file reader's text materials. Only a
 * `.txt` file with no Markdown syntax falls back to a plain <pre>; `.md`,
 * `.markdown`, notes (Planner, Class inbox) and anything with Markdown syntax
 * go through the app's Markdown pipeline. Pure, so the rule is testable.
 */

const PLAIN_TEXT_EXTENSION = /\.txt$/i;

/** Deliberately conservative: match constructs a reader would recognise as
 *  Markdown, without treating ordinary prose (e.g. `some_var_name`, `$5`) as
 *  markup. */
const MARKDOWN_SYNTAX: readonly RegExp[] = [
	/^[ \t]{0,3}#{1,6}[ \t]+/m, // ATX heading
	/^[ \t]{0,3}(?:```|~~~)/m, // fenced code
	/^[ \t]{0,3}>[ \t]?/m, // blockquote
	/^[ \t]{0,3}(?:[-+*][ \t]+|\d+[.)][ \t]+)/m, // bullet / ordered / task list
	/^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m, // horizontal rule
	/^[ \t]*\|.*\|[ \t]*$/m, // table row
	/\*\*[^*\n]+\*\*|__[^_\n]+__/, // strong
	/`[^`\n]+`/, // inline code
	/!?\[[^\]\n]*\]\([^)\n]*\)/, // link / image
	/\$\$|\$(?!\s)[^$\n]+(?<!\s)\$/, // KaTeX inline / display math
];

/** Whether this text material's page should be rendered as Markdown. */
export function shouldRenderMarkdown(fileName: string, text: string): boolean {
	if (!PLAIN_TEXT_EXTENSION.test(fileName.trim())) return true;
	return MARKDOWN_SYNTAX.some((pattern) => pattern.test(text));
}
