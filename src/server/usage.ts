import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { setUsageSink } from "../agent/usage.ts";
import { aggregateUsage, parseUsageLine, type UsageRecord, type UsageReport } from "../core/usage.ts";

/** <data>/usage.jsonl — one line per model call (token diet, 2026-11-20). */
export function usageFile(): string {
	return path.join(/* turbopackIgnore: true */ PATHS.data, "usage.jsonl");
}

export function appendUsage(record: UsageRecord, file = usageFile()): void {
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
	} catch { /* best-effort ledger */ }
}

export function readUsage(file = usageFile()): UsageRecord[] {
	let text: string;
	try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
	const out: UsageRecord[] = [];
	for (const line of text.split("\n")) {
		if (!line) continue;
		const r = parseUsageLine(line);
		if (r) out.push(r);
	}
	return out;
}

export function usageReport(days: number, file = usageFile()): UsageReport {
	return aggregateUsage(readUsage(file), days);
}

/** Install the ledger as the engine layer's usage sink (idempotent). */
export function installUsageSink(): void {
	setUsageSink((record) => appendUsage(record));
}
installUsageSink();
