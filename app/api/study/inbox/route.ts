/**
 * GET  /api/study/inbox?subjectId=…          — recent captures and their status (inbox/index.json)
 * POST /api/study/inbox                      — multipart: subjectId, topicId?, files[] (png/jpg/webp), text?
 *      or captureId to retry a failed capture from its saved originals.
 * The capture is saved and reported immediately; extraction into "Class inbox.md" happens in the background.
 */
import { StudyInputError, createCapture, listCaptures, retryCapture } from "@/src/server";
import { FormBodyLimitError, readBoundedFormData } from "@/lib/bounded-form-data.ts";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
	try { return Response.json({ captures: listCaptures(new URL(request.url).searchParams.get("subjectId")) }); }
	catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not load the inbox." }, { status: 400 }); }
}

export async function POST(request: Request) {
	const maxBytes = 12 * 10 * 1024 * 1024 + 1024 * 1024;
	let form: FormData;
	try { form = await readBoundedFormData(request, maxBytes, request.signal); }
	catch (error) {
		if (error instanceof FormBodyLimitError) return Response.json({ error: "Upload too large: at most 12 screenshots of 10 MB." }, { status: 413 });
		return Response.json({ error: "Could not read the upload." }, { status: 400 });
	}
	try {
		const captureId = form.get("captureId");
		if (typeof captureId === "string" && captureId) return Response.json({ capture: retryCapture(captureId) });
		const files = form.getAll("files").filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
		const textValue = form.get("text");
		const capture = await createCapture({
			subjectId: form.get("subjectId"),
			topicId: form.get("topicId"),
			files,
			text: typeof textValue === "string" ? textValue : "",
		});
		return Response.json({ capture }, { status: 201 });
	} catch (error) {
		return Response.json({ error: error instanceof StudyInputError || error instanceof Error ? error.message : "Capture failed." }, { status: 400 });
	}
}
