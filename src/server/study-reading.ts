/**
 * Reading a material's pages with the vision reader, once, into its page memory. Shared by the chat agent's
 * study_material tool and by "Create notes" (which makes sure the files it summarises have been read).
 */
import type { Usage } from "@earendil-works/pi-ai";
import type { ModelRole } from "../../config.ts";
import type { PiEngine } from "../agent/models.ts";
import { readPages, type WorkerEnv } from "../agent/subagents/study-workers.ts";
import { markTextRead, pageRanges, recordBatch, splitByTextLayer } from "../core/study/material-memory.ts";
import type { Material } from "../core/study/model.ts";
import { studyStore } from "../store/study.ts";
import { study } from "./study-runtime.ts";
import { beginStudyWork } from "./study-activity.ts";

export interface ReadDeps {
	engineFor: (role: ModelRole) => PiEngine | undefined;
	onUsage?: (usage: Usage) => void;
	signal?: AbortSignal;
}

const READ_BATCH = 6;
const TEXT_EXCERPT = 300;

/**
 * Read the not-yet-read pages among `pages`. TEXT FIRST (token diet, 2026-11-20): a page with a real text layer is
 * served from the PDF's own text (free); only image/slide-only pages (< SPARSE_PAGE_CHARS of text) go to the vision
 * model, in batches of 6, and only when this is asked for (study_material / notes), never on upload.
 */
export async function readMaterialPages(m: Material, pages: readonly number[], deps: ReadDeps, chatId?: string): Promise<{ count: number; summaries: string[] }> {
	if (m.kind === "text") return { count: 0, summaries: [] }; // text is remembered whole when it is added
	let memory = studyStore.readMemory(m.sha256);
	let split = splitByTextLayer(memory, pages);
	if (split.unknown.length) {
		await study.extractText(m.sha256, split.unknown);
		memory = studyStore.readMemory(m.sha256);
		split = splitByTextLayer(memory, pages);
	}
	const summaries: string[] = [];
	const count = split.textual.length + split.sparse.length;
	if (!count) return { count: 0, summaries };
	if (split.textual.length) {
		for (const n of split.textual) summaries.push(`page ${n}: ${memory.pages[n]!.replace(/\s+/g, " ").trim().slice(0, TEXT_EXCERPT)}`);
		studyStore.writeMemory(m.sha256, markTextRead(studyStore.readMemory(m.sha256), split.textual));
		summaries.push(`(pages ${pageRanges(split.textual)} come from the file's text layer; the full stored text is in study_context with those pages.)`);
	}
	const todo = split.sparse;
	if (!todo.length) return { count, summaries };
	memory = studyStore.readMemory(m.sha256);
	const env: WorkerEnv = { engine: deps.engineFor("pdfReader"), signal: deps.signal, chatId, onUsage: (usage) => deps.onUsage?.(usage) };
	const work = beginStudyWork(`Reading ${m.fileName}`, `Looking at ${todo.length} image-only page${todo.length === 1 ? "" : "s"} of ${m.pageCount} with the page reader`);
	try {
		for (let i = 0; i < todo.length; i += READ_BATCH) {
			const batch = todo.slice(i, i + READ_BATCH);
			const range = `${batch[0]}–${batch.at(-1)}`;
			work.say(`Looking at pages ${range} (screenshots, text, diagrams)…`);
			const images = await Promise.all(batch.map(async (page) => { const img = await study.pageImage(m.sha256, page); return { page, data: Buffer.from(img.bytes).toString("base64"), mimeType: img.mimeType }; }));
			const read = await readPages(images, m.fileName, env);
			memory = recordBatch(studyStore.readMemory(m.sha256), { pages: read.pages, summary: read.summary, concepts: read.concepts, toc: read.toc, figures: read.figures });
			studyStore.writeMemory(m.sha256, memory);
			summaries.push(`pages ${range}: ${read.summary}`);
			work.say(`Understood pages ${range}: ${read.summary}${read.concepts.length ? ` — concepts: ${read.concepts.slice(0, 6).join(", ")}` : ""}`);
		}
		work.say(`Finished reading ${todo.length} page${todo.length === 1 ? "" : "s"} of ${m.fileName}; remembered so they are never reread.`);
		return { count, summaries };
	} finally { work.done(); }
}
