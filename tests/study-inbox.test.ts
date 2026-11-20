/** Pure parts of the class capture inbox: deadline lines, note sections and the index. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	appendCaptureSection, captureSectionHeading, capturesOf, emptyInboxIndex, extractDeadlines, patchCapture,
	RECENT_CAPTURES, upsertCapture, type Capture,
} from "../src/core/study/inbox.ts";

const NOW = new Date("2026-11-20T10:00:00Z");

describe("inbox deadline extraction", () => {
	it("takes dated due/deadline/exam lines and files them with a kind", () => {
		const md = [
			"## Announcements",
			"- Essay due 2026-12-01",
			"- Exam on 15 December",
			"- Quiz: 3 March 2027",
			"- Homework is due on 5 February",
			"- Read chapter 4",
		].join("\n");
		assert.deepEqual(extractDeadlines(md, NOW), [
			{ title: "Essay", due: "2026-12-01", kind: "assignment" },
			{ title: "Exam", due: "2026-12-15", kind: "exam" },
			{ title: "Quiz", due: "2027-03-03", kind: "quiz" },
			{ title: "Homework", due: "2027-02-05", kind: "assignment" },
		]);
	});

	it("ignores lines without a real date and deduplicates repeats", () => {
		const md = "Assignment due tomorrow\n- Due 2026-02-30\n- Deadline 2026-12-01\n- Deadline 2026-12-01\n";
		assert.deepEqual(extractDeadlines(md, NOW), [{ title: "Course deadline", due: "2026-12-01", kind: "assignment" }]);
	});

	it("keeps an explicit year and rejects impossible month dates", () => {
		assert.deepEqual(extractDeadlines("Midterm due 31 February 2027\nExam on 4 July 2027", NOW), [
			{ title: "Exam", due: "2027-07-04", kind: "exam" },
		]);
	});
});

describe("inbox note sections", () => {
	const at = "2026-11-20T14:35:07.000Z";

	it("headings are dated in UTC", () => {
		assert.equal(captureSectionHeading(at), "## 2026-11-20 14:35");
	});

	it("appends one section with a blank line before it", () => {
		assert.equal(appendCaptureSection("# Class\n", "**Definition**\n", at), "# Class\n\n## 2026-11-20 14:35\n\n**Definition**\n");
		assert.equal(appendCaptureSection("", "First\n", at), "## 2026-11-20 14:35\n\nFirst\n");
		const two = appendCaptureSection(appendCaptureSection("", "First", at), "Second", "2026-11-20T15:00:00Z");
		assert.match(two, /First\n\n## 2026-11-20 15:00\n\nSecond\n$/);
	});

	it("an empty extraction changes nothing", () => {
		assert.equal(appendCaptureSection("# Class\n", "  \n", at), "# Class\n");
	});
});

describe("inbox index updates", () => {
	const capture = (id: string, status: Capture["status"] = "processing"): Capture => ({
		id, subjectId: "sub_1", ...(id === "cap_two" ? { topicId: "top_1" } : {}),
		createdAt: `2026-11-20T10:0${id.slice(-1)}:00Z`, status, files: [],
	});

	it("inserts newest first, replaces by id and patches only that capture", () => {
		let index = upsertCapture(emptyInboxIndex(), capture("cap_one"));
		index = upsertCapture(index, capture("cap_two"));
		assert.deepEqual(index.captures.map((c) => c.id), ["cap_two", "cap_one"]);
		index = upsertCapture(index, capture("cap_one", "added"));
		assert.deepEqual(index.captures.map((c) => c.id), ["cap_one", "cap_two"]);
		index = patchCapture(index, "cap_two", { status: "failed", error: "No model" });
		assert.equal(index.captures[1]!.status, "failed");
		assert.equal(index.captures[1]!.error, "No model");
		assert.equal(index.captures[0]!.error, undefined);
		index = patchCapture(index, "cap_missing", { status: "added" });
		assert.deepEqual(index.captures.map((c) => c.status), ["added", "failed"]);
	});

	it("lists a subject's captures, including topic captures, newest first and bounded", () => {
		const many = Array.from({ length: RECENT_CAPTURES + 3 }, (_, i) => capture(`cap_c${String(i).padStart(2, "0")}`));
		const index = { captures: [...many, capture("cap_other", "added")] };
		index.captures[0] = { ...index.captures[0]!, subjectId: "sub_other" };
		const list = capturesOf(index, "sub_1");
		assert.equal(list.length, RECENT_CAPTURES);
		assert.ok(list.every((c) => c.subjectId === "sub_1"));
		assert.deepEqual(capturesOf(index, "sub_other").map((c) => c.id), ["cap_c00"]);
	});

	it("a cleared error survives the JSON index without an undefined field", () => {
		const index = patchCapture(upsertCapture(emptyInboxIndex(), capture("cap_one", "failed")), "cap_one", { status: "processing", error: undefined });
		const json = JSON.parse(JSON.stringify(index)) as typeof index;
		assert.equal("error" in json.captures[0]!, false);
		assert.equal(json.captures[0]!.status, "processing");
	});
});
