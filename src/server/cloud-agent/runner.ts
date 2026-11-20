/**
 * The background runner: one pass every minute, plus a coalesced pass on
 * `sources-changed`. Hub failures double the delay up to 15 minutes; a
 * success resets it. Nothing here throws into the app.
 */
import { subscribe } from "../../core/events.ts";
import { studyStore } from "../../store/study.ts";
import { runCommands, type CommandSummary } from "./commands.ts";
import { loadCloudAgentConfig, type CloudAgentConfig } from "./config.ts";
import { HubClient } from "./client.ts";
import { mirrorLibrary, type MirrorResult } from "./mirror.ts";

const INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

export interface PassResult {
	mirror: MirrorResult;
	commands: CommandSummary;
}

/** A single mirror + commands pass (also what the CLI runs with `--once`). */
export async function runCloudAgentPass(config: CloudAgentConfig | null = loadCloudAgentConfig()): Promise<PassResult> {
	if (!config) throw new Error("Cloud agent is disabled: HUB_URL and HUB_TOKEN are required.");
	const hub = new HubClient(config);
	const mirror = await mirrorLibrary({ store: studyStore, hub });
	const commands = await runCommands({ hub, device: config.device });
	return { mirror, commands };
}

interface ActiveRunner {
	stop: () => void;
}

let active: ActiveRunner | null = null;

/** Start the runner when configured. Safe to call more than once; returns its stop hook. */
export function startCloudAgent(): () => void {
	if (active) return active.stop;
	// Node tests import modules directly; they must never inherit a live timer.
	if (process.env.NODE_ENV === "test") return () => {};
	const config = loadCloudAgentConfig();
	if (!config) return () => {};

	let disposed = false;
	let running = false;
	let pending = false;
	let failures = 0;
	let nextAllowedAt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const delay = () => failures === 0 ? INTERVAL_MS : Math.min(INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
	const schedule = (ms: number) => {
		if (disposed) return;
		timer = setTimeout(() => void tick(), ms);
	};

	const tick = async () => {
		if (disposed) return;
		if (running) { pending = true; return; }
		running = true;
		let ok = false;
		try {
			await runCloudAgentPass(config);
			ok = true;
		} catch (error) {
			console.error("[cloud-agent] pass failed; retrying with backoff:", error);
		} finally {
			running = false;
			failures = ok ? 0 : failures + 1;
			nextAllowedAt = Date.now() + delay();
			if (ok && pending) {
				pending = false;
				schedule(0);
			} else {
				schedule(delay());
			}
		}
	};

	const requestPass = () => {
		if (disposed) return;
		if (running || Date.now() < nextAllowedAt) { pending = true; return; }
		if (timer) clearTimeout(timer);
		void tick();
	};
	const unsubscribe = subscribe((event) => {
		if (event.type === "sources-changed") requestPass();
	});

	schedule(0); // catch up at startup as well as on the timer
	const stop = () => {
		if (disposed) return;
		disposed = true;
		if (timer) clearTimeout(timer);
		unsubscribe();
		active = null;
	};
	active = { stop };
	return stop;
}

/** For graceful shutdown / tests. */
export function stopCloudAgent(): void {
	active?.stop();
}
