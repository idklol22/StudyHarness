import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPluginGraphService } from "../src/server/plugin-graph.ts";
import { NotesImportError } from "../src/agent/subagents/extraction.ts";
import { PLUGIN_GRAPH_IMPORT_MAX_BYTES } from "../src/core/plugins.ts";

function service(importNotes: (input: { filePath: string; text: string }) => Promise<{ nodes: number; chains?: number }>, signal = new AbortController().signal) {
	return createPluginGraphService({ pluginId: "living-notes", pluginName: "Living Notes", signal, importNotes });
}

describe("plugin graph service", () => {
	it("namespaces the source by plugin and reports merged counts", async () => {
		const seen: { filePath: string; text: string }[] = [];
		const result = await service(async (input) => { seen.push(input); return { nodes: 4, chains: 2 }; }).importNotes({ name: "  Deck A  ", text: "Facts." });
		assert.deepEqual(result, { nodes: 4, chains: 2 });
		assert.deepEqual(seen, [{ filePath: "Living Notes/Deck A", text: "Facts." }]);
	});

	it("defaults missing chain counts to zero", async () => {
		assert.deepEqual(await service(async () => ({ nodes: 1 })).importNotes({ name: "d", text: "t" }), { nodes: 1, chains: 0 });
	});

	it("rejects invalid input before any model work", async () => {
		let calls = 0;
		const s = service(async () => { calls++; return { nodes: 0 }; });
		await assert.rejects(s.importNotes({ name: "", text: "x" }), /1–200/);
		await assert.rejects(s.importNotes({ name: "x".repeat(201), text: "x" }), /1–200/);
		await assert.rejects(s.importNotes({ name: "bad\nname", text: "x" }), /printable/);
		await assert.rejects(s.importNotes({ name: "n", text: "   " }), /blank/);
		await assert.rejects(s.importNotes({ name: "n", text: "x".repeat(PLUGIN_GRAPH_IMPORT_MAX_BYTES + 1) }), /bytes/);
		await assert.rejects(s.importNotes(null as never), /name, text/);
		assert.equal(calls, 0);
	});

	it("maps pipeline outcomes to error codes a plugin can act on", async () => {
		for (const outcome of ["busy", "partial", "aborted", "failed"] as const) {
			const s = service(async () => { throw new NotesImportError(outcome, { nodes: 1, chains: 0 }, `outcome ${outcome}`); });
			await assert.rejects(s.importNotes({ name: "n", text: "t" }), (e: Error & { code?: string }) => e.code === outcome && e.message === `outcome ${outcome}`);
		}
		const missing = service(async () => { throw new Error("Models are not configured."); });
		await assert.rejects(missing.importNotes({ name: "n", text: "t" }), (e: Error & { code?: string }) => e.code === "not-configured");
		const other = service(async () => { throw new Error("boom"); });
		await assert.rejects(other.importNotes({ name: "n", text: "t" }), (e: Error & { code?: string }) => e.code === "failed");
	});

	it("refuses to start after the plugin was disabled", async () => {
		const controller = new AbortController(); controller.abort();
		let calls = 0;
		await assert.rejects(service(async () => { calls++; return { nodes: 0 }; }, controller.signal).importNotes({ name: "n", text: "t" }), (e: Error & { code?: string }) => e.code === "aborted");
		assert.equal(calls, 0);
	});
});
