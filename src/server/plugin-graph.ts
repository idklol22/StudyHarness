import { NotesImportError } from "../agent/subagents/extraction.ts";
import { PLUGIN_GRAPH_IMPORT_MAX_BYTES, type PluginGraphImportError, type PluginGraphService } from "../core/plugins.ts";

export interface PluginGraphDeps {
	pluginId: string;
	pluginName: string;
	signal: AbortSignal;
	/** The host's extraction front door. Resolved lazily to avoid an import cycle with the chat handler. */
	importNotes(input: { filePath: string; text: string }): Promise<{ nodes: number; chains?: number }>;
}

function pluginError(code: PluginGraphImportError["code"], message: string, cause?: unknown): PluginGraphImportError {
	const error = new Error(message, { cause }) as PluginGraphImportError;
	error.code = code;
	return error;
}

/** Validate a plugin-supplied import and run it through the same pipeline as an imported notes
 * file. The graph source path is namespaced by plugin so one plugin can never overwrite another's
 * (or the user's) sources, and nothing here exposes learner state: the caller supplies text only. */
export function createPluginGraphService(deps: PluginGraphDeps): PluginGraphService {
	return {
		async importNotes(input) {
			if (deps.signal.aborted) throw pluginError("aborted", "The plugin was disabled.");
			if (!input || typeof input !== "object") throw new Error("importNotes needs {name, text}.");
			const { name, text } = input;
			if (typeof name !== "string" || !name.trim() || name.length > 200 || /[\u0000-\u001f]/.test(name)) throw new Error("Graph source name must be 1–200 printable characters.");
			if (typeof text !== "string" || !text.trim()) throw new Error("Graph import text must not be blank.");
			if (Buffer.byteLength(text, "utf8") > PLUGIN_GRAPH_IMPORT_MAX_BYTES) throw new Error(`Graph import text is over ${PLUGIN_GRAPH_IMPORT_MAX_BYTES} bytes.`);
			try {
				const stats = await deps.importNotes({ filePath: `${deps.pluginName}/${name.trim()}`, text });
				return { nodes: stats.nodes, chains: stats.chains ?? 0 };
			} catch (error) {
				if (error instanceof NotesImportError) throw pluginError(error.outcome === "busy" ? "busy" : error.outcome, error.message, error);
				const message = error instanceof Error ? error.message : String(error);
				// Missing model/key configuration surfaces as its own code so a plugin can say so plainly.
				throw pluginError(/not configured|key/i.test(message) ? "not-configured" : "failed", message, error);
			}
		},
	};
}
