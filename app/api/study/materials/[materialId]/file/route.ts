/** GET /api/study/materials/<materialId>/file — the managed copy, streamed to the in-app PDF reader. */
import fs from "node:fs";
import { Readable } from "node:stream";
import { StudyInputError, study } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ materialId: string }> }) {
	const { materialId } = await params;
	try {
		const material = study.material(materialId);
		const file = study.materialPath(material.sha256);
		if (!fs.existsSync(file)) return Response.json({ error: "That file is no longer stored." }, { status: 404 });
		const stream = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream<Uint8Array>;
		return new Response(stream, { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=3600" } });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : "Could not load the file." }, { status: error instanceof StudyInputError ? 404 : 500 });
	}
}
