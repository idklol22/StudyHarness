/** CORS for the local Planner dev server talking to the Harness (Harness H1). */

const DEFAULT_ORIGINS = ["http://localhost:5173", "http://localhost:4173"];

/** Read at request time so an env change needs no restart. Blank entries are ignored. */
export function plannerOrigins(env: Record<string, string | undefined> = process.env): string[] {
	const value = env.PLANNER_ORIGINS;
	const list = value === undefined ? DEFAULT_ORIGINS : value.split(",");
	return list.map((origin) => origin.trim()).filter(Boolean);
}

/** Echo only a configured origin; an unknown origin simply gets no CORS grant. */
export function plannerCorsHeaders(request: Request, methods: string): Record<string, string> {
	const headers: Record<string, string> = {
		Vary: "Origin",
		"Access-Control-Allow-Methods": methods,
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "86400",
	};
	const origin = request.headers.get("origin");
	if (origin && plannerOrigins().includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
	return headers;
}

/** Preflight for the same methods as the route actually serves. */
export function plannerPreflight(request: Request, methods: string): Response {
	return new Response(null, { status: 204, headers: plannerCorsHeaders(request, methods) });
}
