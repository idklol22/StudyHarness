/**
 * Descriptive chat titles (owner 2026-11-19: "like ChatGPT — a better title based on the content, not just the
 * headings"). A chat starts with a provisional title cut from the learner's first words; after the tutor's first reply
 * a cheap model writes a title about what the chat is actually about. A title the learner renamed is never touched.
 */
import type { ModelRole } from "../../config.ts";
import type { PiEngine } from "../agent/models.ts";
import { titleChat } from "../agent/subagents/study-workers.ts";
import { titleFromPrompt } from "../core/contracts.ts";
import { placementScopeLabel, subjectOf } from "../core/study/model.ts";
import { stores } from "./stores.ts";
import { study } from "./study-runtime.ts";
import { chatLines } from "./study-digest.ts";

const titled = new Set<string>();
const FILE_PATH = /[`"']?(?:[A-Za-z]:[\\/]|\/)[^`"'\n]*?([^\\/`"'\n]+\.(?:pdf|md|markdown|txt))[`"']?/gi;

/** The text the titler sees: attached paths shortened to file names. */
export function openingOf(text: string): { text: string; files: string[] } {
	const files: string[] = [];
	const clean = text.replace(FILE_PATH, (_m, name: string) => { files.push(name); return name; });
	return { text: clean, files };
}

export function titleAfterFirstTurn(chatId: string, deps: { engineFor: (role: ModelRole) => PiEngine | undefined }): void {
	if (titled.has(chatId)) return;
	const record = stores.chatStore.getChat(chatId);
	if (!record || record.kind === "practice") return;
	const lines = chatLines(record);
	const first = lines.find((l) => l.startsWith("Learner: "));
	const reply = lines.find((l) => l.startsWith("Tutor: "));
	if (!first || !reply) return; // wait for the tutor's first answer
	const opening = openingOf(first.slice("Learner: ".length));
	// Only a title still equal to the provisional one is ours to replace (a rename by the learner wins).
	const provisional = titleFromPrompt(first.slice("Learner: ".length).replace(/\s+/g, " ").trim());
	if (record.title !== provisional && record.title !== titleFromPrompt(first.slice("Learner: ".length))) { titled.add(chatId); return; }
	titled.add(chatId);
	const lib = study.library();
	const subject = record.placement ? subjectOf(lib, record.placement.subjectId) : undefined;
	const place = record.placement && subject ? placementScopeLabel(lib, record.placement) : "no subject";
	void (async () => {
		const title = await titleChat({ opening: opening.text, reply: reply.slice("Tutor: ".length), files: opening.files, place }, { engine: deps.engineFor("extractor"), signal: undefined, chatId });
		const current = stores.chatStore.getChat(chatId);
		if (title && current && current.title === record.title) stores.chatStore.renameChat(chatId, title);
	})().catch((error) => { titled.delete(chatId); console.error("[title] could not title the chat:", error); });
}
