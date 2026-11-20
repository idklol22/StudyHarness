/**
 * The cloud-agent mirror: row diff (new/changed/deleted), file upload list and
 * a full pass against a fake hub. No Next runtime, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Library, Material } from "../src/core/study/model.ts";
import { diffLibrary, emptyMirrorState, mirrorLibrary, readMirrorState } from "../src/server/cloud-agent/mirror.ts";
import { sha256Of, createStudyStore } from "../src/store/study.ts";
import type { HubOp, MirrorHubClient, NewHubEvent, OpsResult } from "../src/server/cloud-agent/types.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const NOW1 = "2026-11-20T09:00:00.000Z";
const NOW2 = "2026-11-20T09:01:00.000Z";
const NOW3 = "2026-11-20T09:02:00.000Z";
const SHA = "a".repeat(64);

function library(): Library {
	const material: Material = {
		id: "mat_1",
		sha256: SHA,
		fileName: "lecture.pdf",
		pageCount: 3,
		bytes: 1234,
		scope: { subjectId: "sub_1", topicId: "top_1" },
		addedAt: "2026-11-01T00:00:00.000Z",
		meta: { lecture: 1, date: "2026-11-01", title: "Lecture 1", kind: "slides" },
	};
	return {
		version: 1,
		subjects: [{ id: "sub_1", name: "Statistics", createdAt: "2026-11-01T00:00:00.000Z", context: "", color: 210 }],
		topics: [{ id: "top_1", subjectId: "sub_1", name: "Regression", order: 0, createdAt: "2026-11-01T00:00:00.000Z", context: "" }],
		materials: [material],
		deadlines: [{ id: "dl_1", subjectId: "sub_1", topicId: "top_1", title: "Problem set", due: "2026-11-25", kind: "assignment", done: false }],
	};
}

const op = (ops: HubOp[], table: HubOp["table"], id: string) => ops.find((entry) => entry.table === table && entry.row.id === id);

class FakeHub implements MirrorHubClient {
	readonly headed: string[] = [];
	readonly putFiles: Array<{ sha: string; bytes: Uint8Array; contentType: string }> = [];
	readonly ops: HubOp[] = [];
	readonly events: NewHubEvent[] = [];
	headResults = new Map<string, boolean>();

	async headFile(sha: string): Promise<boolean> {
		this.headed.push(sha);
		return this.headResults.get(sha) ?? false;
	}
	async putFile(sha: string, bytes: Uint8Array, contentType: string): Promise<unknown> {
		this.putFiles.push({ sha, bytes, contentType });
		return { sha256: sha, bytes: bytes.length };
	}
	async pushOps(ops: readonly HubOp[]): Promise<OpsResult> {
		this.ops.push(...ops);
		return { applied: ops.length, cursor: ops.length };
	}
	async postEvent(event: NewHubEvent): Promise<unknown> {
		this.events.push(event);
		return { id: "evt_1", deduplicated: false };
	}
}

describe("diffLibrary", () => {
	it("emits new h_* rows with title/metadata and lists files to upload", () => {
		const diff = diffLibrary(library(), emptyMirrorState(), NOW1);
		assert.deepEqual(diff.ops.map((entry) => entry.table), ["h_subject", "h_topic", "h_material", "h_deadline"]);
		assert.deepEqual(diff.filesToUpload, [SHA]);
		assert.deepEqual(diff.stats, { materials: 1, bytes: 1234 });

		assert.deepEqual(op(diff.ops, "h_subject", "sub_1")?.row, {
			id: "sub_1", name: "Statistics", color: 'hsl(210 26% 58%)', order: 0, updatedAt: NOW1,
		});
		assert.deepEqual(op(diff.ops, "h_topic", "top_1")?.row, {
			id: "top_1", subjectId: "sub_1", name: "Regression", order: 0, updatedAt: NOW1,
		});
		assert.deepEqual(op(diff.ops, "h_material", "mat_1")?.row, {
			id: "mat_1", subjectId: "sub_1", topicId: "top_1", fileName: "lecture.pdf", title: "Lecture 1",
			kind: "pdf", sha256: SHA, pageCount: 3, lecture: 1, date: "2026-11-01", addedAt: "2026-11-01T00:00:00.000Z",
			updatedAt: NOW1,
		});
		assert.equal(op(diff.ops, "h_deadline", "dl_1")?.row.done, false);
	});

	it("pushes only changed rows with a fresh updatedAt and keeps unchanged stamps", () => {
		const first = diffLibrary(library(), emptyMirrorState(), NOW1);
		const changed = structuredClone(library());
		changed.subjects[0]!.name = "Statistics II";
		changed.materials[0]!.meta!.title = "Lecture 1 (revised)";
		const second = diffLibrary(changed, first.next, NOW2);

		assert.deepEqual(second.ops.map((entry) => entry.row.id), ["sub_1", "mat_1"]);
		assert.equal(op(second.ops, "h_subject", "sub_1")?.row.name, "Statistics II");
		assert.equal(op(second.ops, "h_subject", "sub_1")?.row.updatedAt, NOW2);
		assert.equal(op(second.ops, "h_material", "mat_1")?.row.updatedAt, NOW2);
		assert.equal(op(second.ops, "h_topic", "top_1"), undefined, "unchanged rows are not re-sent");
		assert.deepEqual(second.filesToUpload, [], "the same sha is not uploaded twice");

		const third = diffLibrary(changed, second.next, NOW3);
		assert.deepEqual(third.ops, [], "a no-op pass sends nothing");
	});

	it("turns deleted items into deletedAt tombstones exactly once", () => {
		const first = diffLibrary(library(), emptyMirrorState(), NOW1);
		const smaller = library();
		smaller.topics = [];
		smaller.materials = [];
		smaller.deadlines = [];
		const second = diffLibrary(smaller, first.next, NOW2);

		assert.deepEqual(second.ops.map((entry) => entry.table), ["h_topic", "h_material", "h_deadline"]);
		for (const entry of second.ops) {
			assert.equal(entry.row.deletedAt, NOW2);
			assert.equal(entry.row.updatedAt, NOW2);
		}
		assert.equal(op(second.ops, "h_material", "mat_1")?.row.sha256, SHA, "the tombstone keeps the old fields");
		assert.deepEqual(diffLibrary(smaller, second.next, NOW3).ops, [], "no repeated tombstones");
	});
});

describe("mirrorLibrary", () => {
	it("HEADs then PUTs a new file, pushes ops, writes state and posts harness.mirrored", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-agent-mirror-"));
		roots.push(root);
		const store = createStudyStore(root);
		const bytes = Buffer.from("%PDF-1.4 fake lecture");
		const sha = sha256Of(bytes);
		store.saveMaterial(sha, bytes);
		const lib = library();
		lib.materials[0]!.sha256 = sha;
		store.writeLibrary(lib);
		const stateFile = path.join(root, "cloud-mirror.json");
		const hub = new FakeHub();

		const result = await mirrorLibrary({ store, hub, stateFile, now: NOW1 });

		assert.deepEqual(hub.headed, [sha]);
		assert.deepEqual(hub.putFiles.map((file) => file.sha), [sha]);
		assert.equal(hub.putFiles[0]!.contentType, "application/pdf");
		assert.deepEqual(hub.ops.map((entry) => entry.table), ["h_subject", "h_topic", "h_material", "h_deadline"]);
		assert.equal(result.uploadedFiles, 1);
		assert.equal(hub.events.length, 1);
		assert.equal(hub.events[0]!.type, "harness.mirrored");
		assert.deepEqual(hub.events[0]!.payload, { at: NOW1, materials: 1, bytes: 1234 });
		assert.deepEqual(Object.keys(readMirrorState(stateFile).files), [sha]);

		hub.headResults.set(sha, true);
		const second = await mirrorLibrary({ store, hub, stateFile, now: NOW2 });
		assert.equal(second.uploadedFiles, 0);
		assert.equal(second.ops, 0, "no changes on the second pass");
		assert.deepEqual(hub.putFiles, [hub.putFiles[0]!], "nothing uploaded twice");
	});
});
