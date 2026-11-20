/**
 * The library mirror: diff the Study library against cloud-mirror.json, upload
 * any material file the Hub does not have yet, then push the changed `h_*`
 * rows through /ops and announce the pass with `harness.mirrored`.
 *
 * The Study model has no updatedAt (it hard-deletes rows), so the state file
 * keeps the last content hash: an unchanged row keeps its old stamp, a new or
 * changed row gets this pass's stamp, and a vanished row is re-sent once with
 * deletedAt. State is written only after the Hub accepted the whole pass.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PATHS } from "../../../config.ts";
import type { Library } from "../../core/study/model.ts";
import { subjectColor } from "../../core/study/map.ts";
import { subjectColorCss } from "../../core/study/colors.ts";
import { writeFileAtomicSync } from "../../store/atomic-write.ts";
import type { StudyStore } from "../../store/study.ts";
import type { HubOp, HubRow, HubTable, MirrorHubClient } from "./types.ts";

export const MIRROR_FILE = path.join(PATHS.study, "cloud-mirror.json");

interface StoredRow {
	/** The row (including its last updatedAt/deletedAt) as sent to the hub. */
	row: HubRow;
	/** Hash of the row's CONTENT fields only — timestamps never cause a push. */
	hash: string;
}

export interface MirrorState {
	version: 1;
	rows: Record<string, StoredRow>;
	files: Record<string, { uploadedAt: string }>;
}

export interface MirrorStats {
	materials: number;
	bytes: number;
}

export interface MirrorDiff {
	ops: HubOp[];
	filesToUpload: string[];
	next: MirrorState;
	stats: MirrorStats;
}

export interface MirrorResult extends MirrorStats {
	ops: number;
	uploadedFiles: number;
}

export function emptyMirrorState(): MirrorState {
	return { version: 1, rows: {}, files: {} };
}

const rowKey = (table: HubTable, id: string): string => `${table}:${id}`;
const hashOf = (content: unknown): string => createHash("sha256").update(JSON.stringify(content)).digest("hex");
type Content = Record<string, unknown>;

/** The four CLOUD-PLAN mirror tables, derived from the local library. */
function rowsFromLibrary(library: Library): Array<{ table: HubTable; id: string; content: Content }> {
	const rows: Array<{ table: HubTable; id: string; content: Content }> = [];
	for (const [order, subject] of library.subjects.entries()) {
		rows.push({
			table: "h_subject",
			id: subject.id,
			content: { name: subject.name, color: subjectColorCss(subjectColor(library.subjects, subject.id)), order },
		});
	}
	for (const topic of library.topics) {
		rows.push({
			table: "h_topic",
			id: topic.id,
			content: { subjectId: topic.subjectId, name: topic.name, order: topic.order },
		});
	}
	for (const material of library.materials) {
		rows.push({
			table: "h_material",
			id: material.id,
			content: {
				subjectId: material.scope.subjectId,
				topicId: material.scope.topicId ?? null,
				fileName: material.fileName,
				title: material.meta?.title ?? material.fileName,
				kind: material.kind === "text" ? "text" : "pdf",
				sha256: material.sha256,
				pageCount: material.pageCount,
				lecture: material.meta?.lecture ?? null,
				date: material.meta?.date ?? null,
				addedAt: material.addedAt,
			},
		});
	}
	for (const deadline of library.deadlines ?? []) {
		rows.push({
			table: "h_deadline",
			id: deadline.id,
			content: {
				subjectId: deadline.subjectId,
				topicId: deadline.topicId ?? null,
				title: deadline.title,
				due: deadline.due,
				kind: deadline.kind,
				done: deadline.done ?? false,
			},
		});
	}
	return rows;
}

/** Pure diff — exported so the new/changed/deleted cases are testable without IO. */
export function diffLibrary(library: Library, previous: MirrorState = emptyMirrorState(), now = new Date().toISOString()): MirrorDiff {
	const ops: HubOp[] = [];
	const rows: Record<string, StoredRow> = {};
	const current = rowsFromLibrary(library);
	const currentKeys = new Set(current.map((row) => rowKey(row.table, row.id)));

	for (const { table, id, content } of current) {
		const key = rowKey(table, id);
		const hash = hashOf(content);
		const old = previous.rows[key];
		const unchanged = old && !old.row.deletedAt && old.hash === hash;
		const row: HubRow = { id, ...content, updatedAt: unchanged ? old.row.updatedAt : now };
		if (!unchanged) ops.push({ table, row });
		rows[key] = { row, hash };
	}

	for (const [key, old] of Object.entries(previous.rows)) {
		if (old.row.deletedAt || currentKeys.has(key)) continue;
		const separator = key.indexOf(":");
		const table = key.slice(0, separator) as HubTable;
		const id = key.slice(separator + 1);
		const row: HubRow = { ...old.row, deletedAt: now, updatedAt: now };
		ops.push({ table, row });
		rows[key] = { row, hash: old.hash };
	}

	const shas = [...new Set(library.materials.map((material) => material.sha256))];
	const files: Record<string, { uploadedAt: string }> = {};
	for (const sha of shas) files[sha] = { uploadedAt: previous.files[sha]?.uploadedAt ?? now };
	return {
		ops,
		filesToUpload: shas.filter((sha) => !previous.files[sha]),
		next: { version: 1, rows, files },
		stats: { materials: library.materials.length, bytes: library.materials.reduce((sum, m) => sum + m.bytes, 0) },
	};
}

export function readMirrorState(file: string = MIRROR_FILE): MirrorState {
	try {
		const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<MirrorState> | null;
		if (raw?.version !== 1 || !raw.rows || typeof raw.rows !== "object" || Array.isArray(raw.rows)) return emptyMirrorState();
		const rows: Record<string, StoredRow> = {};
		for (const [key, value] of Object.entries(raw.rows)) {
			const stored = value as StoredRow | null;
			if (stored && typeof stored.hash === "string" && typeof stored.row?.id === "string" && typeof stored.row.updatedAt === "string") {
				rows[key] = stored;
			}
		}
		const files: Record<string, { uploadedAt: string }> = {};
		if (raw.files && typeof raw.files === "object" && !Array.isArray(raw.files)) {
			for (const [sha, value] of Object.entries(raw.files)) {
				if (typeof (value as { uploadedAt?: unknown } | null)?.uploadedAt === "string") {
					files[sha] = { uploadedAt: (value as { uploadedAt: string }).uploadedAt };
				}
			}
		}
		return { version: 1, rows, files };
	} catch {
		return emptyMirrorState(); // absent/corrupt state: mirror everything once more
	}
}

export function writeMirrorState(state: MirrorState, file: string = MIRROR_FILE): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	writeFileAtomicSync(file, `${JSON.stringify(state, null, "\t")}\n`);
}

export interface MirrorDeps {
	store: Pick<StudyStore, "readLibrary" | "materialPath">;
	hub: MirrorHubClient;
	stateFile?: string;
	now?: string;
}

/** One mirror pass. Throws to the caller on hub failures so the runner can back off. */
export async function mirrorLibrary({ store, hub, stateFile = MIRROR_FILE, now = new Date().toISOString() }: MirrorDeps): Promise<MirrorResult> {
	const library = store.readLibrary();
	const diff = diffLibrary(library, readMirrorState(stateFile), now);
	let uploadedFiles = 0;

	for (const sha of diff.filesToUpload) {
		const material = library.materials.find((m) => m.sha256 === sha);
		if (!material) continue;
		const ext = material.kind === "text" ? "txt" : "pdf";
		const local = store.materialPath(sha, ext);
		if (!fs.existsSync(local)) {
			// The file was deleted concurrently: leave it out of the state so a later pass retries.
			delete diff.next.files[sha];
			continue;
		}
		if (!(await hub.headFile(sha))) {
			const bytes = await fs.promises.readFile(local);
			await hub.putFile(sha, new Uint8Array(bytes), ext === "txt" ? "text/plain" : "application/pdf");
			uploadedFiles++;
		}
	}

	for (let i = 0; i < diff.ops.length; i += 10) await hub.pushOps(diff.ops.slice(i, i + 10));
	writeMirrorState(diff.next, stateFile);
	await hub.postEvent({
		type: "harness.mirrored",
		source: "harness",
		ts: now,
		payload: { at: now, materials: diff.stats.materials, bytes: diff.stats.bytes },
	});
	return { ...diff.stats, ops: diff.ops.length, uploadedFiles };
}
