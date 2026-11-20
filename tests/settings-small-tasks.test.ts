/** Token diet: follow-up model choice and the OpenRouter small-task route. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRoleSpecRouted, resolveSideQuestionSpec, smallTaskOpenRouter } from "../src/core/settings-resolution.ts";
import { sanitizeSmallTasks, type UserSettings } from "../src/core/settings.ts";
import { parseAgentSettingsBody } from "../src/server/settings-body.ts";

const models: UserSettings["models"] = {
	strong: { model: { provider: "claude-code", id: "sonnet" } },
	cheap: { model: { provider: "claude-code", id: "haiku" }, thinkingLevel: "low" },
	vision: { model: { provider: "claude-code", id: "haiku" } },
};
const rec = (agent?: UserSettings["agent"]): UserSettings => ({ version: 1, models, ...(agent ? { agent } : {}) });

describe("follow-up (side question) model", () => {
	it("defaults to the cheap slot", () => {
		const spec = resolveSideQuestionSpec(undefined, rec());
		assert.deepEqual([spec?.provider, spec?.id, spec?.thinkingLevel], ["claude-code", "haiku", "low"]);
	});
	it("uses the chat's strong conversation chain when the owner picks strong", () => {
		const spec = resolveSideQuestionSpec(undefined, rec({ smallTasks: { followUpModel: "strong" } }));
		assert.equal(spec?.id, "sonnet");
	});
	it("an explicit sideQuestion override still wins; no cheap slot falls back to strong", () => {
		assert.equal(resolveSideQuestionSpec(undefined, rec({ models: { sideQuestion: { model: { provider: "x", id: "y" } } } }))?.id, "y");
		assert.equal(resolveSideQuestionSpec(undefined, { version: 1, models: { strong: models!.strong } })?.id, "sonnet");
	});
});

describe("OpenRouter for small tasks", () => {
	const on = { smallTasks: { openRouter: { enabled: true, model: { provider: "openrouter" as const, id: "google/gemini-flash" } } } };
	it("routes cheap-slot roles and follow-ups only with the toggle, a picked model and a key", () => {
		assert.equal(resolveRoleSpecRouted("extractor", rec(on), true)?.provider, "openrouter");
		assert.equal(resolveSideQuestionSpec(undefined, rec(on), true)?.id, "google/gemini-flash");
		assert.equal(resolveRoleSpecRouted("extractor", rec(on), false)?.provider, "claude-code", "no key: off");
		assert.equal(smallTaskOpenRouter(rec({ smallTasks: { openRouter: { enabled: false, model: on.smallTasks.openRouter.model } } }), true), undefined);
		assert.equal(smallTaskOpenRouter(rec({ smallTasks: { openRouter: { enabled: true } } }), true), undefined, "no model picked");
	});
	it("never touches the vision or conversation roles, and a per-role override wins", () => {
		assert.equal(resolveRoleSpecRouted("pdfReader", rec(on), true)?.provider, "claude-code");
		assert.equal(resolveRoleSpecRouted("teacher", rec(on), true)?.id, "sonnet");
		assert.equal(resolveRoleSpecRouted("extractor", rec({ ...on, models: { extractor: { model: { provider: "a", id: "b" } } } }), true)?.id, "b");
	});
});

describe("smallTasks settings shape", () => {
	it("sanitizes leniently and parses strictly", () => {
		assert.deepEqual(sanitizeSmallTasks({ followUpModel: "strong", openRouter: { enabled: true, model: { provider: "openrouter", id: " m " } }, junk: 1 }), { followUpModel: "strong", openRouter: { enabled: true, model: { provider: "openrouter", id: "m" } } });
		assert.equal(sanitizeSmallTasks({ followUpModel: "huge" }), undefined);
		assert.equal(parseAgentSettingsBody({ smallTasks: { followUpModel: "huge" } }).ok, false);
		assert.equal(parseAgentSettingsBody({ smallTasks: { openRouter: { model: { provider: "openai", id: "x" } } } }).ok, false);
		const ok = parseAgentSettingsBody({ smallTasks: { followUpModel: "cheap", openRouter: { enabled: true, model: { provider: "openrouter", id: "m" } } } });
		assert.equal(ok.ok && ok.settings.smallTasks?.openRouter?.model?.id, "m");
	});
});
