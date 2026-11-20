/**
 * G1 (2026-11-21): the ONLY graph-update channel. Turns no longer extract.
 *
 * `updateGraphNow` runs the existing extraction pipeline over the chats that
 * still have uncovered teacher prose. Coverage is derived (never tracked
 * twice): `coverageOf` + `batchRuns` decide which chats have work and how
 * many runs each will cost, so already-extracted messages are skipped and
 * nothing is repeated. The pipeline itself keeps its per-chat single-flight
 * and checkpoints coverage per merged batch; this module adds ONE process-wide
 * lock so concurrent triggers (daily tick, Refresh button, Create notes)
 * share a single pass instead of stacking work.
 *
 * The caller labels the work for the usage tracker: `withUsageTask("graph")`,
 * background by default — a user-pressed Refresh passes `background: false`.
 */
import { batchRuns, coverageOf } from "../core/coverage.ts";
import type { CoverageEntry } from "../core/coverage.ts";
import type { LhMessage } from "../core/native-messages.ts";
import type { ChatStore, GraphStore } from "../core/ports.ts";
import type { ExtractionPipeline } from "../agent/subagents/extraction.ts";
import { withUsageTask } from "../agent/usage.ts";

export interface GraphUpdateResult {
	/** Chats that actually had uncovered messages (and were run). */
	chatsProcessed: number;
	/** Planned extraction batches across those chats. */
	runs: number;
}

/** A chat id narrows the pass; several ids serve the "Create notes" scope. */
export interface GraphUpdateScope {
	chatId?: string;
	chatIds?: readonly string[];
}

export interface GraphUpdateDeps {
	chatStore: Pick<ChatStore, "listChats" | "getChat">;
	graphStore: Pick<GraphStore, "readCoverage">;
	chunkTokens: number;
	extraction: Pick<ExtractionPipeline, "runExtraction">;
}

export interface GraphUpdateOptions {
	/** Usage-tracker flag: background unless this came from the Refresh button. */
	background?: boolean;
	/** Test seam — injected stores/pipeline; production resolves them lazily. */
	deps?: GraphUpdateDeps;
}

/**
 * The pure plan: which chats have work, and how many batches each will run.
 * Practice sessions stay out (a practice session is the deliverable, not
 * knowledge), exactly as under the retired per-turn trigger.
 */
export function graphUpdatePlan(
	records: ReadonlyArray<{ id: string; kind?: string; messages: ReadonlyArray<LhMessage> }>,
	entries: ReadonlyArray<CoverageEntry>,
	chunkTokens: number,
): Array<{ chatId: string; runs: number }> {
	const out: Array<{ chatId: string; runs: number }> = [];
	for (const record of records) {
		if (record.kind === "practice") continue;
		const covered = coverageOf(record.messages, entries, record.id);
		const runs = batchRuns(covered.slots, covered.uncovered, chunkTokens).length;
		if (runs > 0) out.push({ chatId: record.id, runs });
	}
	return out;
}

// globalThis: route bundles, the scheduler and the chat composition root
// must share ONE in-flight promise (the usage sink's precedent).
const IN_FLIGHT = Symbol.for("learnharness.graphUpdate.inFlight");
const globals = globalThis as unknown as Record<symbol, Promise<GraphUpdateResult> | undefined>;

/** The running pass, if any — also read by the scheduler to avoid a second tick. */
export function graphUpdateInFlight(): Promise<GraphUpdateResult> | undefined {
	return globals[IN_FLIGHT];
}

/** Run the graph update now (one shared pass). A second call while one is
 *  running returns the SAME promise — no second set of model calls. */
export function updateGraphNow(scope: GraphUpdateScope = {}, options: GraphUpdateOptions = {}): Promise<GraphUpdateResult> {
	const running = graphUpdateInFlight();
	if (running) return running;

	const task = withUsageTask("graph", async () => {
		const deps = options.deps ?? await defaultDeps();
		const ids = scope.chatId
			? [scope.chatId]
			: scope.chatIds
				? [...scope.chatIds]
				: deps.chatStore.listChats().map((c) => c.id);
		const records = [...new Set(ids)].flatMap((id) => {
			const record = deps.chatStore.getChat(id);
			return record ? [record] : [];
		});
		// One coverage read for the whole pass (the ledger is append-only);
		// each pipeline run re-derives its own slice before extracting.
		const entries = deps.graphStore.readCoverage();
		const plan = graphUpdatePlan(records, entries, deps.chunkTokens);
		let chatsProcessed = 0;
		let runs = 0;
		for (const target of plan) {
			await deps.extraction.runExtraction(target.chatId);
			chatsProcessed++;
			runs += target.runs;
		}
		return { chatsProcessed, runs };
	}, { background: options.background ?? true });

	const promise = Promise.resolve(task);
	globals[IN_FLIGHT] = promise;
	const clear = () => { if (globals[IN_FLIGHT] === promise) delete globals[IN_FLIGHT]; };
	void promise.then(clear, clear);
	return promise;
}

/** Production deps, resolved lazily so pure tests (and core modules) never
 *  pull in the chat handler just to import this file. */
async function defaultDeps(): Promise<GraphUpdateDeps> {
	const [server, handler] = await Promise.all([
		import("./stores.ts"),
		import("./chat-handler.ts"),
	]);
	return {
		chatStore: server.stores.chatStore,
		graphStore: server.stores.graphStore,
		chunkTokens: server.effectiveSettings().graph.extractionChunkTokens,
		extraction: handler.extraction,
	};
}
