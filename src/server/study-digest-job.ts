/**
 * A file is understood the moment it arrives (owner 2026-11-19: "as soon as I upload a file, it starts to infer it").
 * For every new material, in the background and visible in the activity dock:
 *   1. full text of every page (no model: the PDF's own text) into the file's memory;
 *   2. a vision skim of the first pages — 20% of the file, at most 8;
 *   3. a compact outline of the whole document from that text;
 *   4. topics and ideas: a subject-wide file gets 1–2 broad SUGGESTED topics (accepted by the learner on the subject
 *      page); a file added to a topic adds its ideas to that topic straight away;
 *   5. the owning scope's context learns what the file contains.
 * After a suggestion is accepted, each topic's context is seeded from its pages.
 */
import { fieldOf, suggestTopics } from "../agent/subagents/study-workers.ts";
import { FIELDS, isField } from "../core/study/fields.ts";
import { ideasOf } from "../core/study/ideas.ts";
import { parseRange } from "../core/study/material-memory.ts";
import { subjectOf, topicOf, topicsOf, type Material, type SuggestedTopic } from "../core/study/model.ts";
import { documentOutline, skimPageCount } from "../core/study/outline.ts";
import { studyStore } from "../store/study.ts";
import { beginStudyWork } from "./study-activity.ts";
import { refreshContext, type StudyDeps } from "./study-context.ts";
import { readMaterialPages } from "./study-reading.ts";
import { study } from "./study-runtime.ts";

const TEXT_BATCH = 40;
const running = new Set<string>();

/** The whole-document outline from the file's memory (page texts, else the skim's summaries). */
function outlineOf(m: Material): string {
	const memory = studyStore.readMemory(m.sha256);
	const withText = Object.values(memory.pages).filter((t) => t.trim()).length;
	if (withText >= Math.min(3, m.pageCount)) return documentOutline({ pages: memory.pages, pageCount: m.pageCount, toc: memory.toc });
	// A scanned file has no text layer: the skim is all there is.
	return memory.chunks.map((c) => `pages ${c.from}–${c.to}: ${c.summary} [${c.concepts.join(", ")}]`).join("\n") || `${m.fileName}: no readable text.`;
}

/** Understand a newly added file in the background. Never throws; safe to call twice (a running file is skipped). */
export function digestMaterial(materialId: string, deps: StudyDeps, chatId?: string): void {
	if (running.has(materialId)) return;
	running.add(materialId);
	void (async () => {
		const first = study.library().materials.find((x) => x.id === materialId);
		if (!first) return;
		const work = beginStudyWork(`Understanding ${first.fileName}`, `New file in ${first.scope.topicId ? "the topic" : "the subject"}: ${first.pageCount} page${first.pageCount === 1 ? "" : "s"}`);
		try {
			// 1. Full text, no model.
			if (first.kind !== "text") {
				let withText = 0;
				for (let from = 1; from <= first.pageCount; from += TEXT_BATCH) {
					const to = Math.min(first.pageCount, from + TEXT_BATCH - 1);
					work.say(`Extracting the text of pages ${from}–${to} of ${first.pageCount}…`);
					withText += await study.extractText(first.sha256, parseRange(`${from}-${to}`, first.pageCount));
				}
				work.say(withText ? `Text extracted from ${withText} of ${first.pageCount} pages.` : "No text layer (a scanned file): relying on the page reader.");
				// 2. A vision skim of the opening pages (contents, intro, figures).
				const skim = skimPageCount(first.pageCount);
				work.say(`Looking at the first ${skim} page${skim === 1 ? "" : "s"} with the page reader (contents, diagrams)…`);
				const { summaries } = await readMaterialPages(first, parseRange(`1-${skim}`, first.pageCount), deps, chatId);
				if (summaries.length) work.say(`Skimmed: ${summaries.join(" ").slice(0, 300)}`);
			}
			// 3–4. Outline → topics and ideas.
			const m = study.library().materials.find((x) => x.id === materialId);
			if (!m) return;
			const lib = study.library();
			const topic = m.scope.topicId ? topicOf(lib, m.scope.topicId) : undefined;
			work.say(topic ? `Working out which ideas of "${topic.name}" this file covers…` : "Working out which topics this file covers…");
			const outline = outlineOf(m);
			const proposals = await suggestTopics({
				fileName: m.fileName, pageCount: m.pageCount, outline,
				existing: topicsOf(lib, m.scope.subjectId).map((t) => ({ id: t.id, name: t.name, context: t.context })),
				...(topic ? { intoTopic: topic.name } : {}),
			}, { engine: deps.engineFor("extractor"), signal: deps.signal, chatId, onUsage: (u) => deps.onUsage?.(u) });
			const suggested: SuggestedTopic[] = proposals.map((p) => ({ name: p.name, ...(p.existingTopicId ? { topicId: p.existingTopicId } : {}), pages: { from: p.from, to: p.to }, summary: p.summary, ideas: p.ideas }));
			if (topic) {
				const ideas = suggested[0]?.ideas ?? [];
				study.addIdeas(m.scope, ideas.map((i) => ({ name: i.name, summary: i.summary, file: { materialId: m.id, pages: i.pages } })));
				work.say(`Added ${ideas.length} idea${ideas.length === 1 ? "" : "s"} to ${topic.name}: ${ideas.map((i) => i.name).join(", ")}`);
			} else if (suggested.length) {
				study.suggestTopics(m.id, suggested);
				work.say(`Suggested ${suggested.length === 1 ? "a topic" : "2 topics"}: ${suggested.map((s) => `${s.name} (pages ${s.pages.from}–${s.pages.to})`).join(", ")} — accept on the subject page.`);
			}
			// 5. The owning scope learns what the file holds.
			const digest = suggested.map((s) => `${s.name} (pages ${s.pages.from}–${s.pages.to}): ${s.summary}\nIdeas: ${s.ideas.map((i) => `${i.name} — ${i.summary}`).join("; ")}`).join("\n\n");
			if (digest) await refreshContext(m.scope, `New file ${m.fileName} (${m.pageCount} pages):\n${digest}`, deps, chatId, "Learning from new files");
			work.say(`Understood ${m.fileName}.`);
		} catch (error) {
			console.error("[study] could not digest a file:", error);
			work.say(`Could not finish understanding ${first.fileName}: ${error instanceof Error ? error.message : String(error)}`);
		} finally { work.done(); running.delete(materialId); }
	})();
}

/** After topics were accepted: each topic's context is seeded from its summary, ideas and the text of its pages. */
export function seedAcceptedTopics(accepted: ReadonlyArray<{ topicId: string; material: Material; suggested: SuggestedTopic }>, deps: StudyDeps): void {
	void (async () => {
		for (const { topicId, material, suggested } of accepted) {
			const lib = study.library();
			const topic = topicOf(lib, topicId);
			if (!topic || !subjectOf(lib, topic.subjectId)) continue;
			const memory = studyStore.readMemory(material.sha256);
			const pages: Record<number, string> = {};
			for (let n = suggested.pages.from; n <= suggested.pages.to; n++) if (memory.pages[n]) pages[n] = memory.pages[n]!;
			const outline = documentOutline({ pages, pageCount: material.pageCount }, 8000);
			const ideas = ideasOf(lib, { subjectId: topic.subjectId, topicId }).map((i) => `${i.name} — ${i.summary}`).join("; ");
			await refreshContext({ subjectId: topic.subjectId, topicId }, `This topic now holds ${material.fileName}, pages ${suggested.pages.from}–${suggested.pages.to}.\nSummary: ${suggested.summary}\nIdeas: ${ideas}\nOutline of its pages:\n${outline}`, deps, undefined, "Building the topic");
		}
	})().catch((error) => console.error("[study] could not seed accepted topics:", error));
}

/** File a new subject under its broad field with a cheap model (the keyword guess stands until then). Never throws. */
export function classifySubject(subjectId: string, deps: StudyDeps): void {
	void (async () => {
		const subject = subjectOf(study.library(), subjectId);
		if (!subject) return;
		const field = await fieldOf(subject.name, FIELDS, { engine: deps.engineFor("extractor"), signal: deps.signal });
		if (isField(field)) study.setField(subjectId, field);
	})().catch((error) => console.error("[study] could not classify a subject:", error));
}
