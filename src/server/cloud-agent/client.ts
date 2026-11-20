/**
 * The Hub HTTP client. One place for bearer auth, path building and timeouts;
 * every request is bounded so an offline hub can never stall the app.
 */
import type { CloudAgentConfig } from "./config.ts";
import type {
	CommandsHubClient,
	HubCommand,
	HubFile,
	HubOp,
	MirrorHubClient,
	NewHubEvent,
	OpsResult,
} from "./types.ts";

export class HubError extends Error {
	constructor(message: string, readonly status?: number) {
		super(message);
		this.name = "HubError";
	}
}

interface SendOptions {
	method: string;
	path: string;
	body?: string | Uint8Array;
	headers?: Record<string, string>;
	allowNotFound?: boolean;
}

export class HubClient implements MirrorHubClient, CommandsHubClient {
	constructor(private readonly config: CloudAgentConfig) {}

	private async send(options: SendOptions): Promise<Response> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.config.hubToken}`,
			...options.headers,
		};
		try {
			const response = await fetch(`${this.config.hubUrl}${options.path}`, {
				method: options.method,
				headers,
				body: options.body as BodyInit | undefined,
				signal: controller.signal,
			});
			if (response.status === 404 && options.allowNotFound) return response;
			if (!response.ok) {
				const detail = await response.text().catch(() => "");
				throw new HubError(
					`Hub ${options.method} ${options.path} failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
					response.status,
				);
			}
			return response;
		} catch (error) {
			if (error instanceof HubError) throw error;
			if (error instanceof Error && error.name === "AbortError") {
				throw new HubError(`Hub ${options.method} ${options.path} timed out after ${this.config.timeoutMs}ms`);
			}
			throw new HubError(`Hub ${options.method} ${options.path} failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			clearTimeout(timer);
		}
	}

	private async json<T>(options: SendOptions): Promise<T> {
		const response = await this.send(options);
		const text = await response.text();
		return (text ? JSON.parse(text) : undefined) as T;
	}

	private post<T>(path: string, payload: unknown): Promise<T> {
		return this.json<T>({
			method: "POST",
			path,
			body: JSON.stringify(payload),
			headers: { "Content-Type": "application/json" },
		});
	}

	async headFile(sha256: string): Promise<boolean> {
		const response = await this.send({ method: "HEAD", path: `/files/${encodeURIComponent(sha256)}`, allowNotFound: true });
		return response.ok;
	}

	async putFile(sha256: string, bytes: Uint8Array, contentType: string): Promise<unknown> {
		return this.json({
			method: "PUT",
			path: `/files/${encodeURIComponent(sha256)}`,
			body: bytes,
			headers: { "Content-Type": contentType },
		});
	}

	async getFile(sha256: string): Promise<HubFile> {
		const response = await this.send({ method: "GET", path: `/files/${encodeURIComponent(sha256)}` });
		return {
			bytes: new Uint8Array(await response.arrayBuffer()),
			contentType: response.headers.get("content-type") ?? "application/octet-stream",
		};
	}

	pushOps(ops: readonly HubOp[]): Promise<OpsResult> {
		return this.post<OpsResult>("/ops", { ops });
	}

	async claimCommand(device: string): Promise<HubCommand | null> {
		const body = await this.post<{ command?: unknown }>("/commands/claim", { device });
		const raw = body?.command;
		if (raw === undefined || raw === null) return null;
		if (!raw || typeof raw !== "object") throw new HubError("Hub returned a malformed command");
		const command = raw as Record<string, unknown>;
		if (typeof command.id !== "string" || typeof command.type !== "string") {
			throw new HubError("Hub returned a malformed command");
		}
		// The base hub stores both parsed JSON and strings; accept either.
		if (typeof command.payload === "string") {
			try { command.payload = JSON.parse(command.payload); }
			catch { command.payload = undefined; }
		}
		return command as unknown as HubCommand;
	}

	completeCommand(id: string, status: "done" | "failed", result: Record<string, unknown>): Promise<unknown> {
		return this.post(`/commands/${encodeURIComponent(id)}/complete`, { status, result });
	}

	postEvent(event: NewHubEvent): Promise<unknown> {
		return this.post("/events", { source: "harness", ...event });
	}
}
