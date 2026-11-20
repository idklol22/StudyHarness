import { usageReport } from "@/src/server/usage";

/** GET /api/usage?days=7 — token usage totals by task, model, day and
 *  background vs interactive, plus the 10 most expensive recent calls. */
export async function GET(req: Request) {
	const raw = Number(new URL(req.url).searchParams.get("days") ?? 7);
	const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 7;
	return Response.json(usageReport(days), { headers: { "Cache-Control": "no-store" } });
}
