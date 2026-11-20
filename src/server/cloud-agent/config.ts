/**
 * Cloud-agent configuration. Both values are required: without a Hub URL or
 * device token the agent is disabled and nothing locally changes behaviour.
 *
 * Precedence: real environment variables → the auth/key store (auth.json,
 * also editable in Settings → Keys) → the non-secret settings record, for
 * older/hand-edited installs that keep a `hub` section there.
 */
import os from "node:os";
import { authStore } from "../../store/auth.ts";
import { settingsStore } from "../../store/settings.ts";

export interface CloudAgentConfig {
	hubUrl: string;
	hubToken: string;
	/** The machine name used to claim commands (CLOUD-PLAN: device = os.hostname()). */
	device: string;
	timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function text(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function fromSettings(): { url?: string; token?: string } {
	try {
		const settings = settingsStore.readSettings();
		const hub = settings?.hub;
		if (hub && typeof hub === "object" && !Array.isArray(hub)) {
			const record = hub as Record<string, unknown>;
			return { url: text(record.url ?? record.hubUrl), token: text(record.token ?? record.hubToken) };
		}
		return { url: text(settings?.hubUrl), token: text(settings?.hubToken) };
	} catch {
		return {};
	}
}

/** Resolve the live config, or null when the agent is disabled. */
export function loadCloudAgentConfig(env: NodeJS.ProcessEnv = process.env): CloudAgentConfig | null {
	const file = authStore.authVars();
	const stored = fromSettings();
	const url = text(env.HUB_URL) ?? text(file.HUB_URL) ?? stored.url;
	const token = text(env.HUB_TOKEN) ?? text(file.HUB_TOKEN) ?? stored.token;
	if (!url || !token) return null;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
	} catch {
		return null;
	}
	return {
		hubUrl: url.replace(/\/+$/, ""),
		hubToken: token,
		device: os.hostname(),
		timeoutMs: DEFAULT_TIMEOUT_MS,
	};
}
