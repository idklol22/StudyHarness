/**
 * Chat attachments become subject/topic files (owner 2026-11-19): when a learner sends a message in a chat
 * placed in a subject or topic, every PDF / Markdown / text file whose path is in the message is saved as a
 * material of that scope (a topic chat's files go to the topic and therefore also show in the subject's files).
 * The library dedupes by file hash, so sending the same file again is a no-op.
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { guardSourcePath, isWithin, realSourcePath } from "../agent/tools/file-access.ts";
import { MAX_MATERIAL_BYTES } from "./study.ts";
import { isTextName } from "../core/study/text-material.ts";
import type { ChatPlacement, Material } from "../core/study/model.ts";
import { study } from "./study-runtime.ts";

const isStudyFile = (p: string) => /\.pdf$/i.test(p) || isTextName(p);

/** Absolute file paths named in a message: quoted ("…" / '…' / `…`, the way the composer writes them) or bare Windows/POSIX paths with a Study file extension. */
export function attachedPaths(text: string): string[] {
	const found = new Set<string>();
	const add = (raw: string | undefined) => {
		const p = raw?.trim().replace(/^file:\/\//i, "").replace(/[.,;:!)\]]+$/, "");
		if (p && isStudyFile(p) && path.isAbsolute(p)) found.add(p);
	};
	for (const m of text.matchAll(/"([^"\n]+)"|'([^'\n]+)'|`([^`\n]+)`/g)) add(m[1] ?? m[2] ?? m[3]);
	for (const m of text.matchAll(/(?:^|[\s(`])([A-Za-z]:[\\/][^\s"'`<>|?*]+|\/[^\s"'`<>|?*]+)/g)) add(m[1]);
	return [...found];
}

export interface Adopted { fileName: string; material?: Material; /** False when this file was already in the scope. */ created?: boolean; error?: string }

/** Save the message's attached files into the chat's scope. Never throws: a bad file is reported, the chat goes on. */
export async function adoptAttachments(placement: ChatPlacement, text: string): Promise<Adopted[]> {
	const out: Adopted[] = [];
	const scope = { subjectId: placement.subjectId, ...(placement.topicId ? { topicId: placement.topicId } : {}) };
	for (const wanted of attachedPaths(text)) {
		const fileName = path.basename(wanted);
		try {
			// Browser uploads live in the app's own folder (always allowed); other paths follow the learner's file-access setting.
			const real = realSourcePath(wanted);
			const absolute = isWithin(real, path.join(PATHS.data, "uploads"), process.platform === "win32") ? real : guardSourcePath(wanted);
			const stat = fs.statSync(absolute);
			if (!stat.isFile()) continue;
			if (stat.size > MAX_MATERIAL_BYTES) { out.push({ fileName, error: "too large" }); continue; }
			const { material, created } = await study.addMaterial({ bytes: new Uint8Array(fs.readFileSync(absolute)), fileName, scope });
			out.push({ fileName, material, created });
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue; // a path-looking string that is not a file
			out.push({ fileName, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return out;
}
