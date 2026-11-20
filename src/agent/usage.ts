import { AsyncLocalStorage } from "node:async_hooks";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { UsageRecord } from "../core/usage.ts";

/**
 * The usage choke point's agent-side half (token diet, 2026-11-20): callers
 * label the work with withUsageTask(); piEngineForSpec's stream wrapper
 * records every model call through the sink the server installs (the agent
 * layer never touches stores).
 */
/** `ambient` labels (a whole chat turn) yield to a more specific engine label. */
export interface UsageContext { task: string; chatId?: string; subjectId?: string; ambient?: boolean; background?: boolean }
const store = new AsyncLocalStorage<UsageContext>();

/** `background` overrides the engine's own flag for one labelled job (G1:
 *  a user-pressed Refresh graph is interactive, the daily/notes passes are
 *  background). Absent = keep the engine's flag — every existing caller
 *  behaves exactly as before. */
export function withUsageTask<T>(task: string, fn: () => T, extra: { chatId?: string; subjectId?: string; ambient?: boolean; background?: boolean } = {}): T {
	const parent = store.getStore();
	return store.run({ task, chatId: extra.chatId ?? parent?.chatId, subjectId: extra.subjectId ?? parent?.subjectId, ...(extra.ambient ? { ambient: true } : {}), ...(extra.background !== undefined ? { background: extra.background } : {}) }, fn);
}

export function currentUsageContext(): UsageContext | undefined {
	return store.getStore();
}

// globalThis: route bundles and the chat composition root must share ONE sink.
const SINK_KEY = Symbol.for("learnharness.usageSink");
type Sink = (record: UsageRecord) => void;
const holder = globalThis as unknown as Record<symbol, Sink | undefined>;
export function setUsageSink(next: Sink | undefined): void {
	holder[SINK_KEY] = next;
}

/** Record one finished model call. Never throws. */
export function recordModelUsage(message: Pick<AssistantMessage, "usage">, meta: { provider: string; model: string; background: boolean; fallbackTask?: string }): void {
	try {
		const u = message.usage;
		const sink = holder[SINK_KEY];
		if (!u || !sink) return;
		const ctx = store.getStore();
		const cost = u.cost?.total;
		sink({
			ts: Date.now(), task: ctx && !ctx.ambient ? ctx.task : (meta.fallbackTask ?? ctx?.task ?? (meta.background ? "background" : "chat")), background: ctx?.background ?? meta.background,
			provider: meta.provider, model: meta.model,
			input: u.input ?? 0, output: u.output ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0,
			...(typeof cost === "number" && cost > 0 ? { costUsd: cost } : {}),
			...(ctx?.chatId ? { chatId: ctx.chatId } : {}),
			...(ctx?.subjectId ? { subjectId: ctx.subjectId } : {}),
		});
	} catch { /* the ledger must never break a model call */ }
}
