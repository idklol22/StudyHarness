/** Token diet: the usage ledger — recording through the choke point, the JSONL file and the aggregation. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { currentUsageContext, recordModelUsage, setUsageSink, withUsageTask } from "../src/agent/usage.ts";
import { aggregateUsage, parseUsageLine, type UsageRecord } from "../src/core/usage.ts";
import { appendUsage, readUsage, usageReport } from "../src/server/usage.ts";
import { submitTaskLabel } from "../src/agent/subagents/submit-agent.ts";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const rec = (over: Partial<UsageRecord>): UsageRecord => ({ ts: NOW - 1000, task: "chat", background: false, provider: "claude-code", model: "sonnet", input: 100, output: 50, cacheRead: 0, cacheWrite: 0, ...over });

describe("aggregateUsage", () => {
	const records = [
		rec({ costUsd: 0.5 }),
		rec({ task: "page-reading", background: true, model: "haiku", input: 1000, output: 100, costUsd: 0.1 }),
		rec({ task: "page-reading", background: true, model: "haiku", input: 500, output: 10, cacheRead: 200 }),
		rec({ ts: NOW - 2 * 86_400_000, task: "context", background: true, model: "haiku", input: 10, output: 5 }),
		rec({ ts: NOW - 30 * 86_400_000, task: "old", input: 9999 }),
	];
	const report = aggregateUsage(records, 7, NOW);

	it("drops records older than the window and totals the rest", () => {
		assert.equal(report.total.calls, 4);
		assert.equal(report.total.input, 1610);
		assert.equal(report.total.cacheRead, 200);
		assert.ok(Math.abs(report.total.costUsd - 0.6) < 1e-9);
	});
	it("groups by task and model, biggest first", () => {
		assert.deepEqual(report.byTask.map((t) => [t.key, t.calls]), [["page-reading", 2], ["chat", 1], ["context", 1]]);
		assert.deepEqual(report.byModel.map((m) => m.key), ["claude-code/haiku", "claude-code/sonnet"]);
	});
	it("splits background from interactive and groups by day (newest first)", () => {
		assert.equal(report.background.calls, 3);
		assert.equal(report.interactive.calls, 1);
		assert.deepEqual(report.byDay.map((d) => d.key), ["2026-11-20", "2026-11-18"]);
	});
	it("lists the most expensive calls first, at most 10", () => {
		assert.equal(report.topCalls[0]!.costUsd, 0.5);
		const many = aggregateUsage(Array.from({ length: 25 }, (_, i) => rec({ input: i })), 7, NOW);
		assert.equal(many.topCalls.length, 10);
		assert.equal(many.topCalls[0]!.input, 24, "unpriced calls rank by tokens");
	});
});

describe("parseUsageLine", () => {
	it("round-trips a record and rejects junk", () => {
		const r = rec({ chatId: "c1", subjectId: "s1", costUsd: 0.01 });
		assert.deepEqual(parseUsageLine(JSON.stringify(r)), r);
		assert.equal(parseUsageLine("not json"), null);
		assert.equal(parseUsageLine(JSON.stringify({ ts: 1 })), null);
	});
});

describe("ledger file", () => {
	const dirs: string[] = [];
	afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); setUsageSink(undefined); });
	it("appends JSON lines and reads them back, skipping a torn line", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-")); dirs.push(dir);
		const file = path.join(dir, "usage.jsonl");
		appendUsage(rec({ task: "a", ts: Date.parse("2020-01-01") }), file);
		fs.appendFileSync(file, "{broken\n");
		appendUsage(rec({ task: "b", ts: Date.parse("2020-01-02") }), file);
		assert.deepEqual(readUsage(file).map((r) => r.task), ["a", "b"]);
		assert.equal(usageReport(7, file).total.calls, 0, "records stamped in the past are outside a window ending today");
		assert.equal(readUsage(path.join(dir, "missing.jsonl")).length, 0);
	});
});

describe("recording seam", () => {
	afterEach(() => setUsageSink(undefined));
	const message = { usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 1, totalTokens: 19, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.002 } } };

	it("labels with the ambient task, chat and subject, and falls back to the engine label", () => {
		const seen: UsageRecord[] = [];
		setUsageSink((r) => seen.push(r));
		recordModelUsage(message, { provider: "p", model: "m", background: true, fallbackTask: "extraction" });
		withUsageTask("page-reading", () => recordModelUsage(message, { provider: "p", model: "m", background: true }), { chatId: "c9", subjectId: "s2" });
		withUsageTask("chat", () => recordModelUsage(message, { provider: "p", model: "m", background: false, fallbackTask: "compaction" }), { ambient: true });
		assert.deepEqual(seen.map((r) => r.task), ["extraction", "page-reading", "compaction"]);
		assert.equal(seen[1]!.chatId, "c9");
		assert.equal(seen[1]!.subjectId, "s2");
		assert.equal(seen[0]!.costUsd, 0.002);
		assert.equal(seen[0]!.cacheRead, 3);
	});
	it("nested labels keep the outer chat id, and a throwing sink never breaks the call", () => {
		withUsageTask("chat", () => withUsageTask("title", () => assert.equal(currentUsageContext()?.chatId, "c1")), { chatId: "c1", ambient: true });
		setUsageSink(() => { throw new Error("disk full"); });
		assert.doesNotThrow(() => recordModelUsage(message, { provider: "p", model: "m", background: false }));
	});
	it("submit agents are labelled by their tool", () => {
		assert.equal(submitTaskLabel("submit_pages", "pdfReader"), "page-reading");
		assert.equal(submitTaskLabel("submit_note", "extractor"), "planner-absorb");
		assert.equal(submitTaskLabel("other", "extractor"), "extraction");
	});
});
