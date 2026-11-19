/** GET /api/study/pages/<materialId>/<page> — the page's screenshot (rendered once, then served from the page cache). */
import { StudyInputError, study } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ materialId: string; page: string }> }) {
	const { materialId, page } = await params;
	try {
		const material = study.material(materialId);
		const n = Number(page);
		if (!Number.isInteger(n) || n < 1 || n > material.pageCount) return Response.json({ error: "No such page." }, { status: 404 });
		// ?format=text, or any page of a text file: the page's text (text files have no images).
		if (material.kind === "text" || new URL(request.url).searchParams.get("format") === "text") {
			return Response.json({ text: study.readMemory(material.sha256).pages[n] ?? "" });
		}
		const image = await study.pageImage(material.sha256, n);
		return new Response(new Uint8Array(image.bytes), { headers: { "Content-Type": image.mimeType, "Cache-Control": "private, max-age=3600" } });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : "Could not load the page." }, { status: error instanceof StudyInputError ? 404 : 500 });
	}
}
