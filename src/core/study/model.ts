/**
 * The Study library (Study overhaul, owner 2026-11-19): SUBJECTS contain TOPICS; PDFs ("materials")
 * are uploaded at subject level (subject-wide context) or topic level (topic-wide context); every
 * chat lives in a subject or a topic of one. Subjects and topics are user-defined and can be created
 * ahead of time or on the spot.
 *
 * Pure: no IO. The store (src/store/study.ts) persists a `Library` and the managed PDF copies; this
 * module owns the rules:
 *   - names are unique (case-insensitively) within their parent;
 *   - a material is a managed copy of a file identified by its SHA-256; adding the same file again to
 *     the same scope is a no-op, and to another scope shares the one stored copy;
 *   - deleting a subject/topic cascades and reports which stored copies became unreferenced, so the
 *     store can remove them (never keep redundant PDFs).
 *
 * Each subject and topic carries a `context` document: a compact running summary kept by the context
 * keeper (see context.ts), injected into chats instead of raw material.
 */

export interface StudyScope {
	subjectId: string;
	/** Absent = subject-wide. */
	topicId?: string;
}

export interface Subject {
	id: string;
	name: string;
	createdAt: string;
	/** Compact running context for the whole subject (maintained by the context keeper). */
	context: string;
	contextUpdatedAt?: string;
	/** Ideas from subject-wide files and chats (see ideas.ts). */
	ideas?: Idea[];
	/** Broad field of study (fields.ts): places related subjects near each other in the 3D graph. */
	field?: string;
	/** The learner's colour for this subject (a hue in degrees); absent = picked automatically. */
	color?: number;
}

export interface Topic {
	id: string;
	subjectId: string;
	name: string;
	order: number;
	createdAt: string;
	/** Compact running context for this topic. */
	context: string;
	contextUpdatedAt?: string;
	/** The key ideas this topic covers, each linked to the files (pages) and chats about it (see ideas.ts). */
	ideas?: Idea[];
}

/** A key idea of a topic or subject, linked to where it is covered. */
export interface Idea {
	id: string;
	name: string;
	summary: string;
	files: Array<{ materialId: string; pages?: string }>;
	chats: string[];
}

/** Topics suggested for a file just added to a subject; the learner accepts or dismisses them. */
export interface SuggestedTopic {
	name: string;
	/** An existing topic this matches (accepting adds to it instead of creating one). */
	topicId?: string;
	pages: { from: number; to: number };
	summary: string;
	ideas: Array<{ name: string; summary: string; pages?: string }>;
}
export interface Suggestion { id: string; materialId: string; createdAt: string; topics: SuggestedTopic[] }

/** One uploaded PDF, attached to a scope. `sha256` names the managed copy and its page memory. */
export interface Material {
	id: string;
	sha256: string;
	fileName: string;
	pageCount: number;
	bytes: number;
	scope: StudyScope;
	addedAt: string;
	/** "text" = a markdown/plain-text file split into virtual pages (no page images); absent = PDF. */
	kind?: "text";
	/** Lecture metadata, guessed on upload and editable by the learner; absent on older files. */
	meta?: { lecture?: number; date?: string /* YYYY-MM-DD */; kind?: "slides" | "handwritten" | "assignment" | "other"; title?: string };
	/** The part of the file this scope uses (a file shared by two topics covers different pages in each). */
	pages?: { from: number; to: number };
}

/** A dated to-do owned by the Harness for now (a Planner app will sync them later). */
export interface Deadline {
	id: string;
	subjectId: string;
	/** Absent = subject-wide. */
	topicId?: string;
	title: string;
	/** ISO date or datetime. */
	due: string;
	kind: "assignment" | "exam" | "quiz" | "other";
	done?: boolean;
}

export interface Library {
	version: 1;
	subjects: Subject[];
	topics: Topic[];
	materials: Material[];
	/** Topic suggestions waiting for the learner. */
	suggestions?: Suggestion[];
	/** Deadlines of subjects (and, optionally, their topics). */
	deadlines?: Deadline[];
}

export const emptyLibrary = (): Library => ({ version: 1, subjects: [], topics: [], materials: [] });

export const NAME_MAX = 120;
export const SHA256 = /^[a-f0-9]{64}$/;

const fail = (message: string): never => { throw new Error(message); };

/** A trimmed, single-line, bounded name. */
export function cleanName(value: unknown, label = "Name"): string {
	if (typeof value !== "string") return fail(`${label} must be text.`);
	const name = value.replace(/\s+/g, " ").trim();
	if (!name) return fail(`${label} must not be empty.`);
	if (name.length > NAME_MAX) return fail(`${label} is at most ${NAME_MAX} characters.`);
	return name;
}

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

export const subjectOf = (lib: Library, id: string): Subject | undefined => lib.subjects.find((s) => s.id === id);
export const topicOf = (lib: Library, id: string): Topic | undefined => lib.topics.find((t) => t.id === id);
export const topicsOf = (lib: Library, subjectId: string): Topic[] =>
	lib.topics.filter((t) => t.subjectId === subjectId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
export const materialsIn = (lib: Library, scope: StudyScope): Material[] =>
	lib.materials.filter((m) => m.scope.subjectId === scope.subjectId && (m.scope.topicId ?? null) === (scope.topicId ?? null));

/**
 * Everything a scope holds, rolled up: a topic's own files; a subject's own files PLUS every topic's.
 * (Owner: whatever appears in a topic also appears in the subject's files.)
 */
export const materialsUnder = (lib: Library, scope: StudyScope): Material[] =>
	scope.topicId ? materialsIn(lib, scope) : lib.materials.filter((m) => m.scope.subjectId === scope.subjectId);

/** Where a material lives, for labels: the topic's name, or "" for a subject-wide file. */
export const materialTopicName = (lib: Library, m: Material): string => (m.scope.topicId ? topicOf(lib, m.scope.topicId)?.name ?? "" : "");

/** The scope must exist (a topic must belong to the named subject). */
export function checkScope(lib: Library, scope: StudyScope): StudyScope {
	if (!subjectOf(lib, scope.subjectId)) fail("That subject no longer exists.");
	if (scope.topicId !== undefined) {
		const topic = topicOf(lib, scope.topicId);
		if (!topic) fail("That topic no longer exists.");
		if (topic?.subjectId !== scope.subjectId) fail("That topic belongs to another subject.");
	}
	return scope.topicId === undefined ? { subjectId: scope.subjectId } : { subjectId: scope.subjectId, topicId: scope.topicId };
}

export interface Fresh { id: string; at: string }
const fresh = (prefix: string, make?: () => Fresh): Fresh => make?.() ?? { id: `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, at: new Date().toISOString() };

/** Create a subject, or return the existing one with this name (so "create on the spot" is idempotent). */
export function createSubject(lib: Library, name: unknown, make?: () => Fresh): { library: Library; subject: Subject; created: boolean } {
	const clean = cleanName(name, "Subject name");
	const existing = lib.subjects.find((s) => same(s.name, clean));
	if (existing) return { library: lib, subject: existing, created: false };
	const f = fresh("sub", make);
	const subject: Subject = { id: f.id, name: clean, createdAt: f.at, context: "" };
	return { library: { ...lib, subjects: [...lib.subjects, subject] }, subject, created: true };
}

export function createTopic(lib: Library, subjectId: string, name: unknown, make?: () => Fresh): { library: Library; topic: Topic; created: boolean } {
	if (!subjectOf(lib, subjectId)) fail("That subject no longer exists.");
	const clean = cleanName(name, "Topic name");
	const existing = lib.topics.find((t) => t.subjectId === subjectId && same(t.name, clean));
	if (existing) return { library: lib, topic: existing, created: false };
	const f = fresh("top", make);
	const order = Math.max(-1, ...lib.topics.filter((t) => t.subjectId === subjectId).map((t) => t.order)) + 1;
	const topic: Topic = { id: f.id, subjectId, name: clean, order, createdAt: f.at, context: "" };
	return { library: { ...lib, topics: [...lib.topics, topic] }, topic, created: true };
}

export function renameSubject(lib: Library, id: string, name: unknown): Library {
	const clean = cleanName(name, "Subject name");
	if (!subjectOf(lib, id)) fail("That subject no longer exists.");
	if (lib.subjects.some((s) => s.id !== id && same(s.name, clean))) fail("Another subject already has that name.");
	return { ...lib, subjects: lib.subjects.map((s) => (s.id === id ? { ...s, name: clean } : s)) };
}

export function renameTopic(lib: Library, id: string, name: unknown): Library {
	const clean = cleanName(name, "Topic name");
	const topic = topicOf(lib, id) ?? fail("That topic no longer exists.");
	if (lib.topics.some((t) => t.id !== id && t.subjectId === topic.subjectId && same(t.name, clean))) fail("Another topic in this subject already has that name.");
	return { ...lib, topics: lib.topics.map((t) => (t.id === id ? { ...t, name: clean } : t)) };
}

/** Store the maintained context document of a subject or topic. */
export function setContext(lib: Library, target: { subjectId: string; topicId?: string }, context: string, at = new Date().toISOString()): Library {
	const text = String(context);
	if (target.topicId !== undefined) {
		if (!topicOf(lib, target.topicId)) fail("That topic no longer exists.");
		return { ...lib, topics: lib.topics.map((t) => (t.id === target.topicId ? { ...t, context: text, contextUpdatedAt: at } : t)) };
	}
	if (!subjectOf(lib, target.subjectId)) fail("That subject no longer exists.");
	return { ...lib, subjects: lib.subjects.map((s) => (s.id === target.subjectId ? { ...s, context: text, contextUpdatedAt: at } : s)) };
}

/** SHA-256 hashes still referenced by any material. */
export const referencedHashes = (lib: Library): Set<string> => new Set(lib.materials.map((m) => m.sha256));

export interface Removal { library: Library; /** Stored copies no material references any more: delete these files and their page memory. */ orphaned: string[] }
function reclaim(before: Library, after: Library): Removal {
	const kept = referencedHashes(after);
	return { library: after, orphaned: [...referencedHashes(before)].filter((h) => !kept.has(h)) };
}

/** Delete a subject with its topics, materials and deadlines; reports now-unreferenced stored copies. */
export function deleteSubject(lib: Library, id: string): Removal {
	if (!subjectOf(lib, id)) fail("That subject no longer exists.");
	const topicIds = new Set(lib.topics.filter((t) => t.subjectId === id).map((t) => t.id));
	return reclaim(lib, {
		...lib,
		subjects: lib.subjects.filter((s) => s.id !== id),
		topics: lib.topics.filter((t) => t.subjectId !== id),
		materials: lib.materials.filter((m) => m.scope.subjectId !== id),
		...(lib.deadlines ? { deadlines: lib.deadlines.filter((d) => d.subjectId !== id && !(d.topicId && topicIds.has(d.topicId))) } : {}),
	});
}

/** Delete a topic with its materials and topic deadlines; subject-wide deadlines stay. */
export function deleteTopic(lib: Library, id: string): Removal {
	if (!topicOf(lib, id)) fail("That topic no longer exists.");
	return reclaim(lib, {
		...lib,
		topics: lib.topics.filter((t) => t.id !== id),
		materials: lib.materials.filter((m) => m.scope.topicId !== id),
		...(lib.deadlines ? { deadlines: lib.deadlines.filter((d) => d.topicId !== id) } : {}),
	});
}

export interface NewMaterial { sha256: string; fileName: string; pageCount: number; bytes: number; scope: StudyScope; kind?: "text" }

/**
 * Attach a file to a scope. The same file (same hash) in the same scope is returned as is; in a different
 * scope it gets its own reference but shares the single stored copy (`shared` says the copy already existed).
 */
export function addMaterial(lib: Library, input: NewMaterial, make?: () => Fresh): { library: Library; material: Material; created: boolean; shared: boolean } {
	if (!SHA256.test(input.sha256)) fail("Invalid file hash.");
	const scope = checkScope(lib, input.scope);
	const fileName = cleanName(input.fileName.replace(/^.*[\\/]/, ""), "File name");
	if (!Number.isInteger(input.pageCount) || input.pageCount < 1) fail("The PDF has no pages.");
	const existing = lib.materials.find((m) => m.sha256 === input.sha256 && m.scope.subjectId === scope.subjectId && (m.scope.topicId ?? null) === (scope.topicId ?? null));
	if (existing) return { library: lib, material: existing, created: false, shared: true };
	const shared = lib.materials.some((m) => m.sha256 === input.sha256);
	const f = fresh("mat", make);
	const material: Material = { id: f.id, sha256: input.sha256, fileName, pageCount: input.pageCount, bytes: input.bytes, scope, addedAt: f.at, ...(input.kind ? { kind: input.kind } : {}) };
	return { library: { ...lib, materials: [...lib.materials, material] }, material, created: true, shared };
}

/** Save (or, with an empty patch, clear) a material's lecture details. */
export function setMaterialMeta(lib: Library, id: string, meta: Material["meta"]): Library {
	if (!lib.materials.some((m) => m.id === id)) fail("That file no longer exists.");
	const keep = meta && Object.values(meta).some((v) => v !== undefined) ? meta : undefined;
	return { ...lib, materials: lib.materials.map((m) => {
		if (m.id !== id) return m;
		return keep ? { ...m, meta: keep } : (({ meta: _drop, ...rest }) => rest)(m);
	}) };
}

/** Remove one material reference; the stored copy goes only when nothing else references it. */
export function removeMaterial(lib: Library, id: string): Removal {
	if (!lib.materials.some((m) => m.id === id)) fail("That file no longer exists.");
	return reclaim(lib, { ...lib, materials: lib.materials.filter((m) => m.id !== id) });
}

/** Move a material to another scope (e.g. a topic file promoted to subject-wide). */
export function moveMaterial(lib: Library, id: string, scope: StudyScope): Library {
	const target = checkScope(lib, scope);
	const material = lib.materials.find((m) => m.id === id) ?? fail("That file no longer exists.");
	if (lib.materials.some((m) => m.id !== id && m.sha256 === material.sha256 && m.scope.subjectId === target.subjectId && (m.scope.topicId ?? null) === (target.topicId ?? null))) {
		// The same file is already in the target: drop this duplicate reference.
		return { ...lib, materials: lib.materials.filter((m) => m.id !== id) };
	}
	return { ...lib, materials: lib.materials.map((m) => (m.id === id ? { ...m, scope: target } : m)) };
}

/** A chat's place in the library, chosen when it starts. New writes use `topicIds`; `topicId` is read for
 *  chats saved before several topics per chat existed and is also written alongside a single selected id. */
export interface ChatPlacement {
	subjectId: string;
	/** Legacy single-topic read (kept in sync on single-topic writes). */
	topicId?: string;
	/** All topics this chat draws on. Empty/absent means the whole subject. */
	topicIds?: string[];
	/** "scratch" = lesson-first from the material/topic; "check" = probe what the learner knows first. */
	startMode: "scratch" | "check";
}

type PlacementTopics = Pick<ChatPlacement, "topicId" | "topicIds">;

/** The selected topic ids, newest shape first with the legacy single id as a fallback. Deduped, order preserved. */
export function placementTopicIds(p: PlacementTopics): string[] {
	const raw = Array.isArray(p.topicIds) ? p.topicIds : p.topicId ? [p.topicId] : [];
	return [...new Set(raw.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/** Only ids that exist under this subject. Reads from old records tolerate a deleted topic; writes do not. */
export function selectedTopicIds(lib: Library, p: { subjectId: string } & PlacementTopics): string[] {
	return placementTopicIds(p).filter((id) => topicOf(lib, id)?.subjectId === p.subjectId);
}

/** The single physical scope a chat writes into. Several topics read as a union but write subject-wide. */
export function placementWriteScope(p: { subjectId: string } & PlacementTopics): StudyScope {
	const ids = placementTopicIds(p);
	return ids.length === 1 ? { subjectId: p.subjectId, topicId: ids[0] } : { subjectId: p.subjectId };
}

/** Whether a chat's selected topics include `topicId` (old `topicId` chats included). */
export function placementIncludesTopic(p: PlacementTopics, topicId: string): boolean {
	return placementTopicIds(p).includes(topicId);
}

/** The label of a placement: `Subject`, `Subject › Topic`, or `Subject › 3 topics`. */
export function placementScopeLabel(lib: Library, p: { subjectId: string } & PlacementTopics): string {
	const subject = subjectOf(lib, p.subjectId)?.name ?? "";
	const names = selectedTopicIds(lib, p).map((id) => topicOf(lib, id)!.name);
	const scope = names.length === 0 ? subject : names.length === 1 ? `${subject} › ${names[0]}` : `${subject} › ${names.length} topics`;
	return scope.trim();
}

/** Validate a placement against the library (stale ids refuse, never guess). */
export function checkPlacement(lib: Library, raw: unknown): ChatPlacement {
	const r = (raw ?? {}) as Partial<ChatPlacement>;
	if (typeof r.subjectId !== "string") return fail("Choose a subject for this chat.");
	if (!subjectOf(lib, r.subjectId)) fail("That subject no longer exists.");
	if (r.topicIds !== undefined && !Array.isArray(r.topicIds)) return fail("Topics must be a list.");
	// Validate every id in both shapes: a stale or wrong-subject id in an old or new field refuses the write.
	const given: unknown[] = [...(Array.isArray(r.topicIds) ? r.topicIds : []), ...(r.topicId ? [r.topicId] : [])];
	for (const rawId of given) {
		const topicId: string = typeof rawId === "string" && rawId ? rawId : fail("A topic id must be text.");
		checkScope(lib, { subjectId: r.subjectId, topicId });
	}
	const ids = placementTopicIds(r);
	// No upfront choice any more: a chat that does not say how to start simply starts teaching.
	return {
		subjectId: r.subjectId,
		...(ids.length ? { topicIds: ids, ...(ids.length === 1 ? { topicId: ids[0] } : {}) } : {}),
		startMode: r.startMode === "check" ? "check" : "scratch",
	};
}

/**
 * The other topics of the subject whose context may inform this chat (owner: a topic can draw on the subject
 * and on neighbouring topics; a subject holds what all its topics know). Topics with nothing recorded are
 * skipped; each context is shortened to `each` characters so neighbours never crowd out the chat's own layer.
 */
export function relatedContexts(lib: Library, placement: Pick<ChatPlacement, "subjectId" | "topicId" | "topicIds">, each = 700): Array<{ name: string; context: string; id: string }> {
	const chosen = new Set(selectedTopicIds(lib, placement));
	return topicsOf(lib, placement.subjectId)
		.filter((t) => !chosen.has(t.id) && t.context.trim())
		.map((t) => ({ id: t.id, name: t.name, context: t.context.trim().length > each ? t.context.trim().slice(0, each).trimEnd() + "…" : t.context.trim() }));
}

/** The scopes whose context applies to a chat placed at `placement`: every selected topic, then the subject once. */
export function contextScopes(lib: Library, placement: Pick<ChatPlacement, "subjectId" | "topicId" | "topicIds">): Array<{ level: "topic" | "subject"; name: string; context: string; id: string }> {
	const out: Array<{ level: "topic" | "subject"; name: string; context: string; id: string }> = [];
	const chosen = new Set(selectedTopicIds(lib, placement));
	for (const topic of topicsOf(lib, placement.subjectId)) {
		if (chosen.has(topic.id)) out.push({ level: "topic", name: topic.name, context: topic.context, id: topic.id });
	}
	const subject = subjectOf(lib, placement.subjectId);
	if (subject) out.push({ level: "subject", name: subject.name, context: subject.context, id: subject.id });
	return out;
}

/** Record a subject's broad field (fields.ts). */
export function setField(lib: Library, subjectId: string, field: string): Library {
	if (!subjectOf(lib, subjectId)) fail("That subject no longer exists.");
	return { ...lib, subjects: lib.subjects.map((s) => (s.id === subjectId ? { ...s, field } : s)) };
}

/** Set (or clear, with null) a subject's colour as a hue in degrees. */
export function setColor(lib: Library, subjectId: string, color: number | null): Library {
	if (!subjectOf(lib, subjectId)) fail("That subject no longer exists.");
	if (color !== null && !Number.isFinite(color)) fail("A colour must be a hue in degrees.");
	return { ...lib, subjects: lib.subjects.map((s) => (s.id !== subjectId ? s : color === null ? (({ color: _drop, ...rest }) => rest)(s) : { ...s, color: ((Math.round(color) % 360) + 360) % 360 })) };
}
