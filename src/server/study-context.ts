/**
 * The context keeper's entry point: fold an update into a topic's (or subject's) running context document, and
 * roll a topic's new context up into its subject. Visible in the activity dock. Shared by chats, uploads and notes.
 */
import type { Usage } from "@earendil-works/pi-ai";
import type { ModelRole } from "../../config.ts";
import type { PiEngine } from "../agent/models.ts";
import { keepContext, type WorkerEnv } from "../agent/subagents/study-workers.ts";
import { subjectOf, topicOf } from "../core/study/model.ts";
import { study } from "./study-runtime.ts";
import { beginStudyWork } from "./study-activity.ts";

export interface StudyDeps {
	engineFor: (role: ModelRole) => PiEngine | undefined;
	onUsage?: (usage: Usage) => void;
	signal?: AbortSignal;
}

const worker = (deps: StudyDeps, role: ModelRole, chatId?: string): WorkerEnv => ({ engine: deps.engineFor(role), signal: deps.signal, chatId, onUsage: (usage) => deps.onUsage?.(usage) });

/** Fold a short update into the context document of the scope a material (or chat) belongs to. */
export async function refreshContext(target: { subjectId: string; topicId?: string }, update: string, deps: StudyDeps, chatId: string | undefined, why = "Updating what I know"): Promise<void> {
	const lib = study.library();
	const topic = target.topicId ? topicOf(lib, target.topicId) : undefined;
	const subject = subjectOf(lib, target.subjectId);
	if (!subject || (target.topicId && !topic)) return;
	const level = topic ? "topic" : "subject";
	const current = (topic ?? subject).context;
	const work = beginStudyWork(`${why}: ${(topic ?? subject).name}`, `Folding new material into the ${level} context`);
	try {
		const next = await keepContext({ name: (topic ?? subject).name, level, current, update }, worker(deps, "extractor", chatId));
		study.setContext(target, next);
		work.say(`The ${level} context for ${(topic ?? subject).name} is up to date (${next.length} characters).`);
		// The subject holds what all its topics know: a topic's refreshed context is folded into the subject's too.
		if (topic) {
			const owner = subjectOf(study.library(), subject.id);
			if (!owner) return;
			work.say(`Folding ${topic.name} into what the subject ${owner.name} knows…`);
			const rolled = await keepContext({ name: owner.name, level: "subject", current: owner.context, update: `Topic "${topic.name}" now stands as follows (fold what matters for the whole subject into the subject context, keep it short):\n${next.slice(0, 1800)}` }, worker(deps, "extractor", chatId));
			study.setContext({ subjectId: subject.id }, rolled);
			work.say(`The subject context for ${owner.name} is up to date.`);
		}
	} finally { work.done(); }
}
