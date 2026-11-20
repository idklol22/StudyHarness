/** Shared wire types for the Hub contract in CLOUD-PLAN.md. All JSON is camelCase. */

export type HubTable = "h_subject" | "h_topic" | "h_material" | "h_deadline";

export interface HubRow {
	id: string;
	updatedAt: string;
	deletedAt?: string;
	[key: string]: unknown;
}

/** POST /ops — the hub's base Worker takes `{ ops: [{ table, row }] }`. */
export interface HubOp {
	table: HubTable;
	row: HubRow;
}

export interface OpsResult {
	applied: number;
	cursor: number;
}

export interface HubCommand {
	id: string;
	type: string;
	payload: unknown;
	status?: string;
	claimedBy?: string | null;
	[key: string]: unknown;
}

export interface NewHubEvent {
	type: string;
	payload: unknown;
	source?: string;
	ts?: string;
	idempotencyKey?: string;
}

export interface HubFile {
	bytes: Uint8Array;
	contentType: string;
}

/** The slice of the hub the mirror needs (keeps its tests free of the network). */
export interface MirrorHubClient {
	headFile(sha256: string): Promise<boolean>;
	putFile(sha256: string, bytes: Uint8Array, contentType: string): Promise<unknown>;
	pushOps(ops: readonly HubOp[]): Promise<OpsResult>;
	postEvent(event: NewHubEvent): Promise<unknown>;
}

/** The slice of the hub command dispatch needs. */
export interface CommandsHubClient {
	claimCommand(device: string): Promise<HubCommand | null>;
	completeCommand(id: string, status: "done" | "failed", result: Record<string, unknown>): Promise<unknown>;
	getFile(sha256: string): Promise<HubFile>;
}

export type HubClientLike = MirrorHubClient & CommandsHubClient;
