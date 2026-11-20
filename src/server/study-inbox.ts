/**
 * Class capture inbox (the server half): keeps the originals under `<data>/study/inbox/<id>/`, records their state
 * in `index.json`, extracts the course content with the page-reader vision model and appends it to the scope's
 * `Class inbox.md` text material. Dated lines become ordinary study deadlines.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import { checkScope, materialsIn, type Material, type StudyScope } from "../core/study/model.ts";
import {
	appendCaptureSection, captureSectionHeading, capturesOf, emptyInboxIndex, extractDeadlines, INBOX_INDEX_FILE,
	INBOX_NOTES_FILE, patchCapture, upsertCapture, type Capture, type CaptureFile, type InboxIndex,
} from "../core/study/inbox.ts";
import { extractInbox } from "../agent/subagents/study-workers.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { studyStore } from "../store/study.ts";
import { resolveEngine } from "./chat-handler.ts";
import { beginStudyWork } from "./study-activity.ts";
import { StudyInputError } from "./study.ts";
import { study } from "./study-runtime.ts";

const ROOT = path.join(PATHS.study, "inbox");
const INDEX_FILE = path.join(ROOT, INBOX_INDEX_FILE);
const ID = /^cap_[A-Za-z0-9_-]{8,}$/;
const MIME_EXT: Record<string, "png" | "jpg" | "webp"> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const NAME_EXT: Record<string, CaptureFile["mimeType"]> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
export const MAX_CAPTURE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_CAPTURE_FILES = 12;
export const MAX_CAPTURE_TEXT = 200_000;

const dirOf = (id: string): string => {
	if (!ID.test(id)) throw new StudyInputError("That capture no longer exists.");
	return path.join(ROOT, id);
};

function readIndex(): InboxIndex {
	let raw: unknown;
	try { raw = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyInboxIndex(); throw error; }
	const captures = (raw as InboxIndex)?.captures;
	return { captures: Array.isArray(captures) ? captures.filter((c): c is Capture => !!c && typeof c.id === "string" && typeof c.subjectId === "string") : [] };
}

function writeIndex(index: InboxIndex): void {
	fs.mkdirSync(ROOT, { recursive: true });
	writeFileAtomicSync(INDEX_FILE, `${JSON.stringify(index, null, "\t")}\n`);
	emit("sources-changed", {});
}

const scopeOf = (subjectId: unknown, topicId: unknown): StudyScope => {
	if (typeof subjectId !== "string" || !subjectId) throw new StudyInputError("Choose a subject for these captures.");
	try {
		return checkScope(study.library(), { subjectId, ...(typeof topicId === "string" && topicId ? { topicId } : {}) });
	} catch (error) {
		throw new StudyInputError(error instanceof Error ? error.message : "That scope no longer exists.");
	}
};

/** The error line keeps the UI's failed state useful without exposing a stack. */
const errorText = (error: unknown): string => error instanceof Error ? error.message.slice(0, 300) : "Capture could not be added.";

/** Add a capture: save the originals first, then report "processing" and run the extraction in the background. */
export async function createCapture(input: { subjectId: unknown; topicId?: unknown; files: readonly File[]; text: string }): Promise<Capture> {
	const scope = scopeOf(input.subjectId, input.topicId);
	const files = input.files.slice(0, MAX_CAPTURE_FILES + 1);
	const text = input.text.slice(0, MAX_CAPTURE_TEXT);
	if (!files.length && !text.trim()) throw new StudyInputError("Drop screenshots or paste text first.");
	if (files.length > MAX_CAPTURE_FILES) throw new StudyInputError(`Add at most ${MAX_CAPTURE_FILES} screenshots at once.`);
	const id = `cap_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
	const folder = dirOf(id);
	fs.mkdirSync(folder, { recursive: true });
	const stored: CaptureFile[] = [];
	try {
		for (const [i, file] of files.entries()) {
			const byName = NAME_EXT[path.extname(file.name).toLowerCase()];
			const mimeType = (MIME_EXT[file.type] ? file.type : byName) as CaptureFile["mimeType"] | undefined;
			if (!mimeType) throw new StudyInputError("Only PNG, JPG and WebP screenshots can be added.");
			const bytes = Buffer.from(await file.arrayBuffer());
			if (!bytes.length) throw new StudyInputError("One of those screenshots is empty.");
			if (bytes.length > MAX_CAPTURE_FILE_BYTES) throw new StudyInputError(`A screenshot is larger than ${MAX_CAPTURE_FILE_BYTES / 1024 / 1024} MB.`);
			const storedAs = `${i + 1}.${MIME_EXT[mimeType]}`;
			fs.writeFileSync(path.join(folder, storedAs), bytes);
			stored.push({ name: path.basename(file.name).slice(0, 120), storedAs, mimeType });
		}
		if (text.trim()) fs.writeFileSync(path.join(folder, "text.txt"), text, "utf8");
	} catch (error) {
		fs.rmSync(folder, { recursive: true, force: true });
		throw error;
	}
	const capture: Capture = { id, ...scope, createdAt: new Date().toISOString(), status: "processing", files: stored };
	writeIndex(upsertCapture(readIndex(), capture));
	schedule(id);
	return capture;
}

/** Reprocess the saved originals of a failed capture, keeping its id and its note section. */
export function retryCapture(id: string): Capture {
	const index = readIndex();
	const capture = index.captures.find((c) => c.id === id);
	if (!capture) throw new StudyInputError("That capture no longer exists.");
	const next: Capture = { ...capture, status: "processing", error: undefined, addedAt: undefined };
	writeIndex(patchCapture(index, id, { status: "processing", error: undefined, addedAt: undefined }));
	schedule(id);
	return next;
}

/** GET ?subjectId= — newest first, including captures filed under the subject's topics. */
export function listCaptures(subjectId: unknown): Capture[] {
	if (typeof subjectId !== "string" || !subjectId) throw new StudyInputError("subjectId is required.");
	return capturesOf(readIndex(), subjectId);
}

const inboxNotes = (scope: StudyScope): Material | undefined => materialsIn(study.library(), scope).find((m) => m.fileName === INBOX_NOTES_FILE);

/** Append the section to the scope's text material, creating the material when it does not exist yet. */
async function appendToNotes(scope: StudyScope, markdown: string, at: string): Promise<void> {
	const existing = inboxNotes(scope);
	const current = existing ? studyStore.readText(existing.sha256) : "";
	const heading = captureSectionHeading(at);
	// A failed retry must never add the same section twice; a different capture in the same minute still gets its own.
	if (current.includes(heading) && current.includes(markdown.trim())) return;
	const updated = appendCaptureSection(current, markdown, at);
	if (existing) study.removeMaterial(existing.id);
	try {
		await study.addMaterial({ bytes: Buffer.from(updated, "utf8"), fileName: INBOX_NOTES_FILE, scope });
	} catch (error) {
		if (existing) await study.addMaterial({ bytes: Buffer.from(current, "utf8"), fileName: INBOX_NOTES_FILE, scope }).catch(() => undefined);
		throw error;
	}
}

/** Add dated lines through the existing deadline helper, skipping ones already filed from this capture. */
function addDeadlines(scope: StudyScope, markdown: string): void {
	const existing = new Set((study.library().deadlines ?? []).map((d) => `${d.subjectId}\u0000${d.topicId ?? ""}\u0000${d.title}\u0000${d.due}`));
	for (const d of extractDeadlines(markdown)) {
		const key = `${scope.subjectId}\u0000${scope.topicId ?? ""}\u0000${d.title}\u0000${d.due}`;
		if (existing.has(key)) continue;
		try {
			study.addDeadline({ ...d, ...scope });
			existing.add(key);
		} catch (error) { console.error("[study] capture deadline skipped:", error); }
	}
}

async function processCapture(id: string): Promise<void> {
	const capture = readIndex().captures.find((c) => c.id === id);
	if (!capture) return;
	const scope = { subjectId: capture.subjectId, ...(capture.topicId ? { topicId: capture.topicId } : {}) };
	const work = beginStudyWork("Reading class captures", `Extracting ${capture.files.length} screenshot${capture.files.length === 1 ? "" : "s"} and pasted text`);
	try {
		const folder = dirOf(id);
		const images = capture.files.map((f, i) => ({ page: i + 1, data: fs.readFileSync(path.join(folder, f.storedAs)).toString("base64"), mimeType: f.mimeType }));
		let text = "";
		try { text = fs.readFileSync(path.join(folder, "text.txt"), "utf8"); } catch { /* no pasted text */ }
		work.say("Extracting course content from the captures…");
		const markdown = await extractInbox(images, text, { engine: resolveEngine(images.length ? "pdfReader" : "extractor") });
		work.say("Adding the extracted notes and deadlines…");
		await appendToNotes(scope, markdown, capture.createdAt);
		addDeadlines(scope, markdown);
		writeIndex(patchCapture(readIndex(), id, { status: "added", addedAt: new Date().toISOString(), error: undefined }));
		work.say(`Added to ${INBOX_NOTES_FILE}.`);
	} catch (error) {
		const message = errorText(error);
		writeIndex(patchCapture(readIndex(), id, { status: "failed", error: message }));
		work.say(`Failed: ${message}`);
	} finally { work.done(); }
}

// One capture at a time: notes and deadlines are read-modify-write operations on the same library.
let queue: Promise<unknown> = Promise.resolve();
const queued = new Set<string>();
function schedule(id: string): void {
	if (queued.has(id)) return;
	queued.add(id);
	queue = queue.then(async () => { try { await processCapture(id); } finally { queued.delete(id); } }).catch((error) => console.error("[study] capture inbox job failed:", error));
}
