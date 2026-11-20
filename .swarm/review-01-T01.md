REVIEW: OK

1. No fixes required — HEAD (`29aca6f`, "T01: answer outside course theory descriptively") implements the spec exactly.
2. Prompt edit verified: only line 3 of `src/agent/study-chat-prompt.md` changed, and the old final sentence was replaced byte-for-byte with the spec's NEW text. The other eight lines are untouched, and `Never invent a citation` plus the "check the files first and cite" rule remain intact, preserving the partly-covered edge case.
3. Test verified: `tests/study-chat-prompt.test.ts` is new, root-anchors the shipped asset via `new URL(..., import.meta.url)`, asserts all three required regexes (including `doesNotMatch(/answer normally/)`), asserts all five unchanged invariants, and stays pure (no engine, fetch, or writes).
4. Scope verified: the commit touches only the two files authorised by the spec. No changes to `system-prompt.md`, `prompts/**`, `doctrine.ts`, `prompts/side-chat/**`, or any wiring/config/tool schema/persisted data.
5. UI/UX: N/A per spec — prompt-prose-only change; no component, layout, theme, token, spacing, z-index, or keyboard behaviour is involved, and no UI/UX defect is present in this commit.
6. Checks reproduced successfully: TypeScript clean (`npx tsc --noEmit -p .`, ignoring `plugins/`), and `NODE_ENV=test npx tsx --test tests/study-chat-prompt.test.ts` passes 3/3.
