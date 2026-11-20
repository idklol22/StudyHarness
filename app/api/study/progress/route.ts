/**
 * GET /api/study/progress?subjectId=… — per-file reading/coverage numbers for the Overview dashboard.
 * `readPages` comes from the agent's material memory (read[] per SHA-256); `notedPages` counts the distinct pages
 * the subject's saved notebooks cover. Both are clamped to the file's page count.
 */
import { coverageByFile } from "@/src/core";
import { study, subjectNotebooks } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
	const subjectId = new URL(request.url).searchParams.get("subjectId");
	if (!subjectId) return Response.json({ error: "subjectId is required." }, { status: 400 });
	try {
		const lib = study.library();
		if (!lib.subjects.some((s) => s.id === subjectId)) return Response.json({ error: "That subject no longer exists." }, { status: 400 });
		const materials = lib.materials.filter((m) => m.scope.subjectId === subjectId);
		const byFile = coverageByFile(materials, subjectNotebooks(subjectId));
		const progress = materials.map((m) => {
			const read = new Set(study.readMemory(m.sha256).read.filter((n) => n >= 1 && n <= m.pageCount));
			const noted = new Set<number>();
			for (const part of byFile.get(m.id)?.parts ?? []) {
				for (let n = Math.max(1, part.from); n <= Math.min(m.pageCount, part.to); n++) noted.add(n);
			}
			return { id: m.id, pageCount: m.pageCount, readPages: read.size, notedPages: noted.size };
		});
		return Response.json({ materials: progress });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : "Could not read progress." }, { status: 400 });
	}
}
