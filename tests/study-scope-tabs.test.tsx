/**
 * The pure logic behind the Round 5 subject/topic tabs: reading the active tab from the URL hash, and filtering /
 * sorting the compact files table. No DOM needed — these are the rules the components use.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tabFromHash } from "../components/study/scope-tabs.tsx";
import { sortFiles, type FileRow } from "../components/study/files-table.tsx";

describe("tabFromHash", () => {
	const allowed = ["files", "notes", "flashcards", "chats", "knowledge"];

	it("reads a tab id from a hash with or without the leading #", () => {
		assert.equal(tabFromHash("#notes", allowed, "files"), "notes");
		assert.equal(tabFromHash("files", allowed, "notes"), "files");
		assert.equal(tabFromHash("#flashcards", allowed, "files"), "flashcards");
	});

	it("ignores a query suffix and surrounding whitespace", () => {
		assert.equal(tabFromHash("#notes?notebookId=123", allowed, "files"), "notes");
		assert.equal(tabFromHash("  #chats  ", allowed, "files"), "chats");
	});

	it("falls back on empty, unknown or disallowed ids", () => {
		assert.equal(tabFromHash("", allowed, "topics"), "topics");
		assert.equal(tabFromHash("#", allowed, "topics"), "topics");
		assert.equal(tabFromHash("#ideas", allowed, "files"), "files");
		assert.equal(tabFromHash("#bogus", ["files", "notes"], "files"), "files");
	});
});

describe("sortFiles", () => {
	const rows: FileRow[] = [
		{ id: "a", fileName: "Zebra", topicName: "Math", pageCount: 10, covered: 5, addedAt: "2026-01-01T00:00:00Z" },
		{ id: "b", fileName: "Alpha", topicName: "Physics", pageCount: 4, covered: 0, addedAt: "2026-03-01T00:00:00Z" },
		{ id: "c", fileName: "Beta", topicName: "Math", pageCount: 10, covered: 3, addedAt: "2026-02-01T00:00:00Z" },
		{ id: "d", fileName: "Delta", topicName: "Chemistry", pageCount: 7, covered: 8, addedAt: "2026-01-15T00:00:00Z" },
	];

	it("filters by name and topic, case-insensitively, and trims the query", () => {
		assert.deepEqual(sortFiles(rows, "math", "pages").map((r) => r.id), ["a", "c"], "topic names match too, and equal page counts keep input order");
		assert.deepEqual(sortFiles(rows, "ALP", "name").map((r) => r.id), ["b"]);
		assert.deepEqual(sortFiles(rows, "  beta  ", "name").map((r) => r.id), ["c"]);
		assert.deepEqual(sortFiles(rows, "zzz", "name"), []);
		assert.deepEqual(sortFiles(rows, "   ", "name").map((r) => r.id), ["b", "c", "d", "a"], "an empty query keeps everything (sorted by name)");
	});

	it("sorts by each key: name, topic, pages, coverage and newest-added", () => {
		assert.deepEqual(sortFiles(rows, "", "name").map((r) => r.id), ["b", "c", "d", "a"]);
		assert.deepEqual(sortFiles(rows, "", "topic").map((r) => r.id), ["d", "a", "c", "b"]);
		assert.deepEqual(sortFiles(rows, "", "pages").map((r) => r.id), ["b", "d", "a", "c"]);
		assert.deepEqual(sortFiles(rows, "", "coverage").map((r) => r.id), ["b", "c", "a", "d"]);
		assert.deepEqual(sortFiles(rows, "", "added").map((r) => r.id), ["b", "c", "d", "a"]);
	});

	it("keeps equal rows in their original order for every sort key", () => {
		const ties: FileRow[] = [
			{ id: "1", fileName: "Same", topicName: "Topic", pageCount: 5, covered: 2, addedAt: "2026-01-01T00:00:00Z" },
			{ id: "2", fileName: "Same", topicName: "Topic", pageCount: 5, covered: 2, addedAt: "2026-01-01T00:00:00Z" },
			{ id: "3", fileName: "Same", topicName: "Topic", pageCount: 5, covered: 2, addedAt: "2026-01-01T00:00:00Z" },
		];
		for (const key of ["name", "topic", "pages", "coverage", "added"] as const) {
			assert.deepEqual(sortFiles(ties, "", key).map((r) => r.id), ["1", "2", "3"], `${key} keeps ties stable`);
		}
		assert.deepEqual(sortFiles(rows, "", "pages").map((r) => r.id), ["b", "d", "a", "c"], "a and c both have 10 pages, in input order");
	});

	it("does not mutate its input and returns a new array", () => {
		const before = structuredClone(rows);
		const out = sortFiles(rows, "", "name");
		assert.deepEqual(rows, before);
		assert.notEqual(out, rows);
	});
});
