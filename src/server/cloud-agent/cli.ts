/** `npm run cloud-agent -- --once` for one pass; without --once it loops with backoff. */
import { loadCloudAgentConfig } from "./config.ts";
import { runCloudAgentPass } from "./runner.ts";

const INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
	const config = loadCloudAgentConfig();
	if (!config) {
		console.log("Cloud agent disabled: set HUB_URL and HUB_TOKEN (or add them in Settings → Keys).");
		return;
	}

	let failures = 0;
	for (;;) {
		let ok = false;
		try {
			const { mirror, commands } = await runCloudAgentPass(config);
			console.log(`[cloud-agent] mirrored ${mirror.ops} rows / ${mirror.uploadedFiles} files; ran ${commands.processed} commands.`);
			ok = true;
		} catch (error) {
			console.error("[cloud-agent] pass failed:", error instanceof Error ? error.message : error);
		}
		if (process.argv.includes("--once")) {
			if (!ok) process.exitCode = 1;
			return;
		}
		failures = ok ? 0 : failures + 1;
		const delay = failures === 0 ? INTERVAL_MS : Math.min(INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
		await sleep(delay);
	}
}

void main();
