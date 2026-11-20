REVIEW: OK

No fixes required. Reviewed `ec9d61d` (T16) and the two preceding commits (unrelated: a review note and a prompt-navigation fix). Verified against `03-T16.md`:

1. `src/core/study/doctrine.ts` — `STUDY_CITATION_FORMAT` and `STUDY_TOOL_CITE_HINT` are byte-identical to the spec; the format is pushed once immediately after `matText` and before the `mode === "plain"` return, so it is emitted in teach/practice/plain and stays constant for caching. `room` subtracts `STUDY_CITATION_FORMAT.length`, keeping the variable prefix within `STUDY_BLOCK_CHARS`.
2. `src/server/study-agent.ts` — the single-line hint is appended as the final line of all three `lookup`/`read` result branches (including the "already read" case); `show_figure`, headings, `formatLookup` body and structured payloads are untouched.
3. `src/agent/study-chat-prompt.md:3` — keeps "check the files first", the `(exact file name, p. N)` token and "Never invent a citation"; no second format introduced.
4. `components/panel/side-panel.tsx:86-88` — chip geometry and all theme tokens unchanged; added exactly the prescribed focus classes (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`), which is the established codebase pattern (prompt-navigation, update-banner) and is not suppressed by the global `outline: none` no-ring law (ring is box-shadow based). Click target still `panel.openMaterial(materialId, page)`; panelReducer bumps `nonce` and PdfReaderView re-jumps. The extra `aria-label="Open in side panel"` is harmless and satisfies the spec's "aria-label/title names the side panel action" test (the pre-existing `title` already did; it merely overrides the accessible name with the same action text).
5. `tests/study-citations.test.ts` — covers the verbatim format in teach/plain, the cap, the single-line hint, the range/fenced-code regression and the chip's testid/focus ring; `tests/chat-side-panel.test.ts` stays green.

Checks: `npx tsc --noEmit -p .` has no non-`plugins/` errors; `NODE_ENV=test npx tsx --test tests/study-citations.test.ts tests/chat-side-panel.test.ts tests/study-doctrine-caps.test.ts` → 16/16 pass. Commit message matches the spec.
