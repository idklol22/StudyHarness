/**
 * Cloud-agent command dispatch with a fake hub: claim with the hostname,
 * route harness.note / harness.capture to the injected local handlers, and
 * complete each command with a result or an error.
 */
import assert from "node:assert/strict";
import os from "node:os";
import { describe, it } from "node:test";
import { parseCapturePayload, runCommands } from "../src/server/cloud-agent/commands.ts";
import type { CommandsHubClient, HubCommand, HubFile } from "../src/server/cloud-agent/types.ts";

const command = (id: string, type: string, payload: unknown): HubCommand => ({ id, type, payload, status: "claimed" });

class FakeHub implements CommandsHubClient {
	readonly claimedBy: string[] = [];
	readonly completions: Array<{ id: string; status: string; result: Record<string, unknown> }> = [];
	readonly downloads: string[] = [];

	constructor(
		private queue: HubCommand[],
		private readonly files: Record<string, HubFile> = {},
	) {}

	async claimCommand(device: string): Promise<HubCommand | null> {
		this.claimedBy.push(device);
		return this.queue.shift() ?? null;
	}
	async completeCommand(id: string, status: "done" | "failed", result: Record<string, unknown>): Promise<unknown> {
		this.completions.push({ id, status, result });
		return { ok: true };
	}
	async getFile(sha: string): Promise<HubFile> {
		this.downloads.push(sha);
		const file = this.files[sha];
		if (!file) throw new Error(`No file ${sha}`);
		return file;
	}
}

describe("parseCapturePayload", () => {
	it("accepts a full capture and rejects malformed payloads", () => {
		const sha = "b".repeat(64);
		assert.deepEqual(parseCapturePayload({ subjectId: " sub_1 ", text: "hello", fileShas: [sha] }), {
			subjectId: "sub_1", text: "hello", fileShas: [sha],
		});
		assert.throws(() => parseCapturePayload({ subjectId: "sub_1", fileShas: [42] }), /fileShas/);
		assert.throws(() => parseCapturePayload({ subjectId: "sub_1" }), /fileShas/);
		assert.throws(() => parseCapturePayload({ fileShas: [] }), /subjectId/);
		assert.throws(() => parseCapturePayload(null), /object/);
	});
});

describe("runCommands", () => {
	it("dispatches both command types with the hostname and completes their results", async () => {
		const fileSha = "b".repeat(64);
		const hub = new FakeHub([
			command("cmd_1", "harness.note", { externalId: "task-1", title: "Notes" }),
			command("cmd_2", "harness.capture", { subjectId: "sub_1", topicId: "top_1", text: "paste", fileShas: [fileSha] }),
		], { [fileSha]: { bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" } });

		const seen: unknown[] = [];
		const summary = await runCommands({
			hub,
			handlers: {
				async note(payload) {
					seen.push(payload);
					return { materialId: "mat_note" };
				},
				async capture(payload, hub) {
					const file = await hub.getFile(fileSha);
					return { captureId: "cap_1", bytes: file.bytes.length, files: fileShasFrom(payload) };
				},
			},
		});

		assert.deepEqual(summary, { processed: 2, failed: 0 });
		assert.deepEqual(hub.claimedBy, [os.hostname(), os.hostname(), os.hostname()], "one final claim returns null");
		assert.deepEqual(seen, [{ externalId: "task-1", title: "Notes" }]);
		assert.deepEqual(hub.downloads, [fileSha]);
		assert.deepEqual(hub.completions, [
			{ id: "cmd_1", status: "done", result: { materialId: "mat_note" } },
			{ id: "cmd_2", status: "done", result: { captureId: "cap_1", bytes: 4, files: [fileSha] } },
		]);
	});

	it("completes unknown types and handler errors as failed, then stops at null", async () => {
		const hub = new FakeHub([
			command("cmd_1", "harness.note", { externalId: "task-1" }),
			command("cmd_2", "something.else", {}),
		]);
		const summary = await runCommands({
			hub,
			handlers: { note: async () => { throw new Error("Subject not found."); } },
		});
		assert.deepEqual(summary, { processed: 2, failed: 2 });
		assert.deepEqual(hub.completions, [
			{ id: "cmd_1", status: "failed", result: { error: "Subject not found." } },
			{ id: "cmd_2", status: "failed", result: { error: "Unknown command type: something.else" } },
		]);
		assert.equal(hub.claimedBy.length, 3, "one extra claim returns null and ends the pass");
	});
});

function fileShasFrom(payload: unknown): string[] {
	const raw = payload as { fileShas?: unknown };
	return Array.isArray(raw.fileShas) ? raw.fileShas as string[] : [];
}
