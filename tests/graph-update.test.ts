/**
 * G1 (2026-11-21): the graph-update schedule, the single-flight lock, and
 * the removal of the old per-reply trigger. Pure seams only — no model calls.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { messageFingerprint } from "../src/core/coverage.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import type { UsageRecord } from "../src/core/usage.ts";
import { resolveSettings } from "../src/core/settings-resolution.ts";
import { recordModelUsage, setUsageSink, withUsageTask } from "../src/agent/usage.ts";
import { parseGraphSettingsBody } from "../src/server/settings-body.ts";
import { graphUpdateInFlight, graphUpdatePlan, updateGraphNow, type GraphUpdateDeps } from "../src/server/graph-update.ts";
import { GRAPH_UPDATE_INTERVAL_MS, graphUpdateDue, readLastGraphUpdate, writeLastGraphUpdate } from "../src/server/graph-update-scheduler.ts";

const NOW = Date.parse("2026-11-21T12:00:00Z");
const daily = { enabled: true, updateMode: "daily" as const };

const prose = (id: string): LhMessage => ({ id, role: "assistant", content: [{ type: "text", text: "A long enough teacher explanation to cover." }], timestamp: NOW }) as never;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => { resolve = r; });
	return { promise, resolve };
}

function depsFor(run: (id: string) => Promise<{ nodes: number; chains: number }>): GraphUpdateDeps & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		chatStore: {
			listChats: () => [{ id: "c1" }, { id: "c2" }] as never,
			getChat: (id: string) => ({
				id,
				kind: id === "c2" ? "practice" : "teach",
				messages: id === "empty" ? [] : [prose(`${id}-m1`)],
			}) as never,
		},
		graphStore: { readCoverage: () => [] },
		chunkTokens: 4096,
		extraction: { runExtraction: (id: string) => { calls.push(id); return run(id); } },
	};
}

describe("daily scheduler decision (pure)", () => {
	it("is due on a fresh boot and exactly at the 24h boundary", () => {
		assert.equal(graphUpdateDue(daily, null, NOW), true);
		assert.equal(graphUpdateDue(daily, NOW - GRAPH_UPDATE_INTERVAL_MS, NOW), true);
	});
	it("is not due before 24h, and never in disabled or manual mode", () => {
		assert.equal(graphUpdateDue(daily, NOW - GRAPH_UPDATE_INTERVAL_MS + 1, NOW), false);
		assert.equal(graphUpdateDue({ ...daily, enabled: false }, null, NOW), false);
		assert.equal(graphUpdateDue({ ...daily, updateMode: "manual" }, null, NOW), false);
		assert.equal(graphUpdateDue(daily, Number.NaN, NOW), true);
	});
	it("persists the stamp in the data dir and reads it back", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-graph-update-"));
		try {
			const file = path.join(dir, "last-update.json");
			assert.equal(readLastGraphUpdate(file), null);
			writeLastGraphUpdate(NOW, file);
			assert.equal(readLastGraphUpdate(file), NOW);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("updateGraphNow", () => {
	it("a second call while one is running returns the running promise", async () => {
		const gate = deferred<{ nodes: number; chains: number }>();
		const deps = depsFor(() => gate.promise);
		const first = updateGraphNow({}, { deps });
		const second = updateGraphNow({}, { deps });
		assert.strictEqual(second, first, "same promise — no second set of model calls");
		assert.strictEqual(graphUpdateInFlight(), first);
		await Promise.resolve();
		assert.deepEqual(deps.calls, ["c1"], "practice chats are skipped too");
		gate.resolve({ nodes: 1, chains: 0 });
		assert.deepEqual(await first, { chatsProcessed: 1, runs: 1 });
		assert.equal(graphUpdateInFlight(), undefined, "lock released after settling");
	});

	it("already-covered chats are skipped, and a scope narrows the pass", async () => {
		const deps = depsFor(async () => ({ nodes: 0, chains: 0 }));
		assert.deepEqual(await updateGraphNow({ chatId: "c2" }, { deps }), { chatsProcessed: 0, runs: 0 });
		assert.deepEqual(deps.calls, []);
		assert.equal(graphUpdateInFlight(), undefined);
		const covered = depsFor(async () => ({ nodes: 0, chains: 0 }));
		// One coverage entry per message already folded -> nothing to do.
		const message = prose("c1-m1");
		covered.graphStore.readCoverage = () => [{ chatId: "c1", fp: messageFingerprint(message), tokens: 16, foldedAt: new Date(NOW).toISOString() }];
		assert.deepEqual(await updateGraphNow({}, { deps: covered }), { chatsProcessed: 0, runs: 0 });
		assert.deepEqual(covered.calls, []);
	});

	it("planning uses coverageOf/batchRuns (never re-extracts covered prose)", () => {
		const plan = graphUpdatePlan(
			[{ id: "c1", kind: "teach", messages: [prose("c1-m1")] }, { id: "c2", kind: "practice", messages: [prose("c2-m1")] }],
			[],
			4096,
		);
		assert.deepEqual(plan, [{ chatId: "c1", runs: 1 }]);
	});
});

describe("no per-turn trigger remains", () => {
	const handler = fs.readFileSync(new URL("../src/server/chat-handler.ts", import.meta.url), "utf8");
	const service = fs.readFileSync(new URL("../src/server/turn-service.ts", import.meta.url), "utf8");
	it("the chat handler's onFinish no longer calls extraction", () => {
		assert.ok(handler.includes("onFinish"), "the turn hook still exists");
		assert.ok(!handler.includes("triggerExtraction"));
		assert.ok(!handler.includes("runExtraction"));
	});
	it("the turn-service seam is gone but the pipeline stays for explicit triggers", () => {
		assert.ok(!service.includes("export function triggerExtraction"));
		assert.ok(!service.includes("runExtraction("));
		assert.ok(handler.includes("createExtractionPipeline"));
	});
});

describe("setting + usage label", () => {
	it("updateMode resolves to daily by default and accepts manual", () => {
		assert.equal(resolveSettings({ version: 1 }).graph.updateMode, "daily");
		assert.equal(resolveSettings({ version: 1, graph: { updateMode: "manual" } }).graph.updateMode, "manual");
		assert.deepEqual(parseGraphSettingsBody({ updateMode: "manual" }), { ok: true, settings: { updateMode: "manual" } });
		assert.equal(parseGraphSettingsBody({ updateMode: "weekly" }).ok, false);
	});
	it("the graph task is interactive only for the button", () => {
		const seen: UsageRecord[] = [];
		setUsageSink((record) => seen.push(record));
		try {
			const message = { usage: { input: 1, output: 1 } } as Parameters<typeof recordModelUsage>[0];
			withUsageTask("graph", () => recordModelUsage(message, { provider: "p", model: "m", background: true }), { background: false });
			withUsageTask("graph", () => recordModelUsage(message, { provider: "p", model: "m", background: true }));
			assert.deepEqual(seen.map((r) => [r.task, r.background]), [["graph", false], ["graph", true]]);
		} finally {
			setUsageSink(undefined);
		}
	});
});
