/**
 * POST /api/study/materials — upload PDFs into a subject or topic (multipart: "files", "subjectId", optional
 * "topicId"). Each file is hashed; a file already stored is referenced, never copied again. Slides in other
 * formats must be exported to PDF first. Returns {materials:[{material, created, alreadyStored}], errors:[...]}.
 */
import { MAX_MATERIAL_BYTES, StudyInputError, digestMaterial, resolveEngine, study } from "@/src/server";
import { FormBodyLimitError, readBoundedFormData } from "@/lib/bounded-form-data.ts";

export const dynamic = "force-dynamic";

const MAX_FILES = 12;

export async function POST(request: Request) {
	let form: FormData;
	try { form = await readBoundedFormData(request, MAX_FILES * MAX_MATERIAL_BYTES + 1024 * 1024, request.signal); }
	catch (error) {
		if (error instanceof FormBodyLimitError) return Response.json({ error: `Upload too large: at most ${MAX_FILES} files of ${MAX_MATERIAL_BYTES / 1024 / 1024} MB.` }, { status: 413 });
		return Response.json({ error: "Could not read the upload." }, { status: 400 });
	}
	const subjectId = form.get("subjectId");
	const topicId = form.get("topicId");
	if (typeof subjectId !== "string" || !subjectId) return Response.json({ error: "Choose a subject for these files." }, { status: 400 });
	const files = form.getAll("files").filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
	if (!files.length) return Response.json({ error: "No files were uploaded." }, { status: 400 });
	if (files.length > MAX_FILES) return Response.json({ error: `Upload at most ${MAX_FILES} files at once.` }, { status: 400 });
	const scope = { subjectId, ...(typeof topicId === "string" && topicId ? { topicId } : {}) };
	const materials = [];
	const errors: Array<{ fileName: string; error: string }> = [];
	for (const file of files) {
		try {
			const added = await study.addMaterial({ bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, scope });
			materials.push(added);
			// Understood at once, in the background (visible in the activity dock).
			if (added.created) digestMaterial(added.material.id, { engineFor: resolveEngine });
		}
		catch (error) {
			if (!(error instanceof StudyInputError)) console.error("[study] material upload failed:", error);
			errors.push({ fileName: file.name, error: error instanceof StudyInputError ? error.message : "Could not store that file." });
		}
	}
	return Response.json({ materials, errors, library: study.library() }, { status: materials.length || !errors.length ? 200 : 400 });
}
