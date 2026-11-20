/**
 * G1 (2026-11-21): the daily graph-update scheduler. Started with the server
 * next to the cloud agent (instrumentation.ts). At most one pass per 24h:
 * check at boot, then hourly. The stamp lives in the data dir
 * (`<data>/graph/last-update.json`) so a restart never re-runs early.
 *
 * An automatic pass happens ONLY when graph.enabled and updateMode ===
 * "daily". Manual mode has no scheduler work at all.
 */
import fs from "node:fs";
import path from "node:path";

import { PATHS } from "../../config.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { effectiveSettings } from "./stores.ts";
import { graphUpdateInFlight, updateGraphNow, type GraphUpdateResult } from "./graph-update.ts";

export const GRAPH_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HOURLY_MS = 60 * 60 * 1000;

export const LAST_UPDATE_FILE = path.join(PATHS.graph, "last-update.json");

/** The pure 24h decision (exported for tests): due / not due / disabled /
 *  manual mode. An absent, unparsable or non-positive stamp means "due" —
 *  a first boot or a corrupt stamp must never block updates forever. */
export function graphUpdateDue(
	graph: { enabled: boolean; updateMode: "manual" | "daily" },
	lastUpdateAt: number | null,
	now: number,
): boolean {
	if (!graph.enabled || graph.updateMode !== "daily") return false;
	if (lastUpdateAt === null || !Number.isFinite(lastUpdateAt) || lastUpdateAt <= 0) return true;
	return now - lastUpdateAt >= GRAPH_UPDATE_INTERVAL_MS;
}

/** Read the persisted stamp (epoch ms), or null when absent/corrupt. */
export function readLastGraphUpdate(file: string = LAST_UPDATE_FILE): number | null {
	try {
		const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { lastGraphUpdate?: unknown };
		const value = typeof raw.lastGraphUpdate === "string" ? Date.parse(raw.lastGraphUpdate) : raw.lastGraphUpdate;
		return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
	} catch {
		return null;
	}
}

/** Persist the stamp atomically (crash-safe, the app's store discipline). */
export function writeLastGraphUpdate(at: number, file: string = LAST_UPDATE_FILE): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	writeFileAtomicSync(file, `${JSON.stringify({ lastGraphUpdate: new Date(at).toISOString() }, null, "\t")}\n`, { allowInPlaceFallback: true });
}

/** One scheduled check. Returns the result when a pass ran, null when it was
 *  not due / disabled, or (on error) rethrows to the caller's catch. The
 *  stamp is written only after a successful pass — a failure retries on the
 *  next hourly tick. */
export async function runDailyGraphUpdate(now: number = Date.now()): Promise<GraphUpdateResult | null> {
	const graph = effectiveSettings().graph;
	if (!graphUpdateDue(graph, readLastGraphUpdate(), now)) return null;
	// Another trigger already running? Its result is this tick's result too;
	// stamp once, after the shared pass settles.
	const result = await updateGraphNow();
	writeLastGraphUpdate(now);
	return result;
}

// One scheduler per process (instrumentation's register may run more than
// once in dev). Guarded on globalThis like the other registries.
const SCHEDULER = Symbol.for("learnharness.graphUpdateScheduler");
const globals = globalThis as unknown as Record<symbol, { timer: ReturnType<typeof setInterval>; stop: () => void } | undefined>;

/** Start the boot check + hourly ticks. Safe to call twice; a no-op in tests. */
export function startGraphUpdateScheduler(): () => void {
	const existing = globals[SCHEDULER];
	if (existing) return existing.stop;
	if (process.env.NODE_ENV === "test") return () => {};

	const check = () => {
		if (graphUpdateInFlight()) return;
		void runDailyGraphUpdate().catch((error: unknown) => {
			console.error("[graph] daily update failed:", error);
		});
	};
	check(); // startup check
	const timer = setInterval(check, HOURLY_MS);
	timer.unref?.();
	const stop = () => {
		clearInterval(timer);
		if (globals[SCHEDULER]?.stop === stop) delete globals[SCHEDULER];
	};
	globals[SCHEDULER] = { timer, stop };
	return stop;
}
