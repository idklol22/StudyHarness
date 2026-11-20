/**
 * Planner command dispatch. The machine claims commands with its hostname,
 * runs them against the SAME local helpers the API routes use, and completes
 * each one with a result (or an error the Planner can display).
 */
import os from "node:os";
import type { CommandsHubClient, HubCommand } from "./types.ts";

export interface CommandHandlers {
	note(payload: unknown): Promise<Record<string, unknown>>;
	capture(payload: unknown, hub: CommandsHubClient): Promise<Record<string, unknown>>;
}

export interface CommandSummary {
	processed: number;
	failed: number;
}

const MAX_COMMANDS_PER_PASS = 20;
const MIME_EXT: Record<string, "png" | "jpg" | "webp"> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
};

function requiredString(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
	return value.trim();
}

export interface CapturePayload {
	subjectId: string;
	topicId?: string;
	text: string;
	fileShas: string[];
}

export function parseCapturePayload(payload: unknown): CapturePayload {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Capture payload must be an object.");
	const raw = payload as Record<string, unknown>;
	const topicId = typeof raw.topicId === "string" && raw.topicId.trim() ? raw.topicId.trim() : undefined;
	if (raw.text !== undefined && typeof raw.text !== "string") throw new Error("Capture text must be a string.");
	if (!Array.isArray(raw.fileShas) || raw.fileShas.some((sha) => typeof sha !== "string" || !sha)) {
		throw new Error("Capture fileShas must be a list of file hashes.");
	}
	return {
		subjectId: requiredString(raw.subjectId, "subjectId"),
		...(topicId ? { topicId } : {}),
		text: typeof raw.text === "string" ? raw.text : "",
		fileShas: raw.fileShas as string[],
	};
}

/** The real handlers, loaded lazily so importing the dispatcher never boots the Study service. */
export function createDefaultHandlers(): CommandHandlers {
	return {
		async note(payload) {
			const { validatePlannerNote, upsertPlannerNote, plannerNoteMap } = await import("../planner-notes.ts");
			const { study } = await import("../study-runtime.ts");
			return await upsertPlannerNote(validatePlannerNote(payload), { study, map: plannerNoteMap });
		},
		async capture(payload, hub) {
			const input = parseCapturePayload(payload);
			const { createCapture } = await import("../study-inbox.ts");
			const files = await Promise.all(input.fileShas.map(async (sha, index) => {
				const { bytes, contentType } = await hub.getFile(sha);
				const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "image/png";
				const ext = MIME_EXT[mime] ?? "png";
				return new File([bytes as unknown as BlobPart], `${index + 1}.${ext}`, { type: MIME_EXT[mime] ? mime : "image/png" });
			}));
			const capture = await createCapture({ subjectId: input.subjectId, topicId: input.topicId, text: input.text, files });
			return { captureId: capture.id };
		},
	};
}

export interface RunCommandsDeps {
	hub: CommandsHubClient;
	device?: string;
	handlers?: Partial<CommandHandlers>;
}

/** Claim and run queued commands until the hub has none left (bounded per pass). */
export async function runCommands({ hub, device = os.hostname(), handlers: override }: RunCommandsDeps): Promise<CommandSummary> {
	const handlers: CommandHandlers = { ...createDefaultHandlers(), ...override };
	let processed = 0;
	let failed = 0;
	for (let i = 0; i < MAX_COMMANDS_PER_PASS; i++) {
		const command: HubCommand | null = await hub.claimCommand(device);
		if (!command) break;
		processed++;
		let status: "done" | "failed" = "done";
		let result: Record<string, unknown> = {};
		try {
			switch (command.type) {
				case "harness.note":
					result = await handlers.note(command.payload);
					break;
				case "harness.capture":
					result = await handlers.capture(command.payload, hub);
					break;
				default:
					throw new Error(`Unknown command type: ${command.type}`);
			}
		} catch (error) {
			status = "failed";
			failed++;
			result = { error: error instanceof Error ? error.message.slice(0, 300) : String(error) };
		}
		await hub.completeCommand(command.id, status, result);
	}
	return { processed, failed };
}
