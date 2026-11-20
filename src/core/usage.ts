/**
 * Token-usage ledger records + pure aggregation (token diet, 2026-11-20).
 * One JSON line per model call lands in <data>/usage.jsonl; this module is
 * browser-safe and only folds records into the report the Settings "Usage"
 * section renders.
 */

export interface UsageRecord {
	ts: number;
	task: string;
	background: boolean;
	provider: string;
	model: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	costUsd?: number;
	chatId?: string;
	subjectId?: string;
}

export interface UsageTotals {
	calls: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	costUsd: number;
}

export interface UsageReport {
	days: number;
	total: UsageTotals;
	byTask: Array<{ key: string } & UsageTotals>;
	byModel: Array<{ key: string } & UsageTotals>;
	byDay: Array<{ key: string } & UsageTotals>;
	background: UsageTotals;
	interactive: UsageTotals;
	topCalls: UsageRecord[];
}

const empty = (): UsageTotals => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });

function add(into: UsageTotals, r: UsageRecord): void {
	into.calls += 1;
	into.input += r.input;
	into.output += r.output;
	into.cacheRead += r.cacheRead;
	into.cacheWrite += r.cacheWrite;
	into.costUsd += r.costUsd ?? 0;
}

function group(records: UsageRecord[], keyOf: (r: UsageRecord) => string): Array<{ key: string } & UsageTotals> {
	const map = new Map<string, UsageTotals>();
	for (const r of records) {
		const key = keyOf(r);
		const t = map.get(key) ?? empty();
		add(t, r);
		map.set(key, t);
	}
	return [...map].map(([key, t]) => ({ key, ...t }));
}

/** Tokens a call actually consumed (every channel). */
export function recordTokens(r: Pick<UsageRecord, "input" | "output" | "cacheRead" | "cacheWrite">): number {
	return r.input + r.output + r.cacheRead + r.cacheWrite;
}

/** Parse one ledger line; null when malformed. */
export function parseUsageLine(line: string): UsageRecord | null {
	try {
		const v = JSON.parse(line) as Partial<UsageRecord>;
		if (typeof v.ts !== "number" || typeof v.task !== "string" || typeof v.model !== "string") return null;
		const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
		return {
			ts: v.ts, task: v.task, background: v.background === true, provider: String(v.provider ?? ""), model: v.model,
			input: n(v.input), output: n(v.output), cacheRead: n(v.cacheRead), cacheWrite: n(v.cacheWrite),
			...(typeof v.costUsd === "number" ? { costUsd: v.costUsd } : {}),
			...(typeof v.chatId === "string" ? { chatId: v.chatId } : {}),
			...(typeof v.subjectId === "string" ? { subjectId: v.subjectId } : {}),
		};
	} catch {
		return null;
	}
}

/** Fold records of the last `days` days (relative to `now`) into the report. */
export function aggregateUsage(records: UsageRecord[], days: number, now = Date.now()): UsageReport {
	const since = now - days * 86_400_000;
	const rows = records.filter((r) => r.ts >= since);
	const total = empty();
	const background = empty();
	const interactive = empty();
	for (const r of rows) {
		add(total, r);
		add(r.background ? background : interactive, r);
	}
	const byTokens = (a: { input: number; output: number; cacheRead: number; cacheWrite: number }, b: typeof a) => recordTokens(b) - recordTokens(a);
	return {
		days, total, background, interactive,
		byTask: group(rows, (r) => r.task).sort(byTokens),
		byModel: group(rows, (r) => `${r.provider}/${r.model}`).sort(byTokens),
		byDay: group(rows, (r) => new Date(r.ts).toISOString().slice(0, 10)).sort((a, b) => (a.key < b.key ? 1 : -1)),
		topCalls: [...rows].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || byTokens(a, b)).slice(0, 10),
	};
}
