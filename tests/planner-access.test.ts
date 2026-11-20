import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiRequestRefusal, plannerRequestAllowed } from "../src/server/desktop-access.ts";

const req = (path: string, origin: string | null, host = "localhost:3000") =>
	new Request(`http://${host}${path}`, { method: "POST", headers: { host, ...(origin ? { origin } : {}), "sec-fetch-site": "same-site" } });

describe("Planner access exception", () => {
	it("lets the local Planner POST to /api/planner/*", () => {
		assert.equal(plannerRequestAllowed(req("/api/planner/notes", "http://localhost:4173")), true);
		assert.equal(plannerRequestAllowed(req("/api/planner/notes", "http://127.0.0.1:5173")), true);
		assert.equal(apiRequestRefusal(req("/api/planner/notes", "http://localhost:4173"), { LH_BROWSER_ONLY: "1" }), undefined);
	});
	it("refuses foreign origins, other paths and non-local hosts", () => {
		assert.equal(plannerRequestAllowed(req("/api/planner/notes", "http://evil.example")), false);
		assert.equal(plannerRequestAllowed(req("/api/study/library", "http://localhost:4173")), false);
		assert.equal(plannerRequestAllowed(req("/api/planner/notes", null)), false);
		assert.equal(plannerRequestAllowed(req("/api/planner/notes", "http://localhost:4173", "evil.example")), false);
	});
});
