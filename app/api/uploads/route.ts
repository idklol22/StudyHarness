/**
 * POST /api/uploads — browser attachments (Study redesign, 2026-11). A browser File has no local
 * path, so in the web build the paperclip / drop zone uploads the file here instead: it is saved
 * under `<learning data>/uploads/<batch>/<name>` and the response returns those paths, which enter
 * the draft exactly like desktop attachments (the agent then reads them with its normal tools, e.g.
 * Study's slide import). Multipart field "files"; at most 8 files of 50 MiB each; the actual body is
 * bounded before parsing. Names are reduced to a safe basename; nothing is executed or converted.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../../config.ts";
import { FormBodyLimitError, readBoundedFormData } from "@/lib/bounded-form-data.ts";

export const dynamic = "force-dynamic";

export const MAX_UPLOAD_FILES = 8;
export const MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_FILES * MAX_UPLOAD_FILE_BYTES + 1024 * 1024;

/** A safe single-segment file name (no separators, control characters or dot-only names). */
export function safeUploadName(name: string): string {
	const base = path.basename(String(name).replace(/\\/g, "/")).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^\.+/, "").trim();
	const clipped = base.length > 120 ? base.slice(0, 80) + base.slice(-40) : base;
	return clipped || "upload";
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(request: Request): Promise<Response> {
	let form: FormData;
	try { form = await readBoundedFormData(request, MAX_UPLOAD_BODY_BYTES, request.signal); }
	catch (error) {
		if (error instanceof FormBodyLimitError) return json({ error: `Upload too large: at most ${MAX_UPLOAD_FILES} files of 50 MB each.` }, 413);
		return json({ error: "Could not read the upload." }, 400);
	}
	const files = form.getAll("files").filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
	if (!files.length) return json({ error: "No files were uploaded." }, 400);
	if (files.length > MAX_UPLOAD_FILES) return json({ error: `Upload at most ${MAX_UPLOAD_FILES} files at once.` }, 400);
	const tooBig = files.find((f) => f.size > MAX_UPLOAD_FILE_BYTES);
	if (tooBig) return json({ error: `${tooBig.name} is larger than 50 MB.` }, 413);
	const batch = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
	const directory = path.join(/* turbopackIgnore: true */ PATHS.data, "uploads", batch);
	fs.mkdirSync(directory, { recursive: true });
	const used = new Set<string>();
	const paths: string[] = [];
	for (const file of files) {
		let name = safeUploadName(file.name);
		if (used.has(name.toLowerCase())) {
			const ext = path.extname(name);
			let n = 2;
			while (used.has(`${name.slice(0, name.length - ext.length)} (${n})${ext}`.toLowerCase())) n++;
			name = `${name.slice(0, name.length - ext.length)} (${n})${ext}`;
		}
		used.add(name.toLowerCase());
		const target = path.join(/* turbopackIgnore: true */ directory, name);
		fs.writeFileSync(target, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
		paths.push(target);
	}
	return json({ paths });
}
